import { Queue, Worker, Job } from 'bullmq';
import { connection } from './redis';
import { PrismaClient } from '@prisma/client';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

export const emailQueue = new Queue('email-queue', { connection: connection as any });

const transporter = nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    auth: {
        user: process.env.ETHEREAL_EMAIL,
        pass: process.env.ETHEREAL_PASS,
    },
});

const MIN_DELAY_MS = parseInt(process.env.MIN_DELAY_MS || '2000');
const MAX_EMAILS_PER_HOUR = 200; // Can be env or per user config

interface EmailJobData {
    jobId: string; // Our DB ID
    recipient: string;
    subject: string;
    body: string;
    userId: string;
}

export const emailWorker = new Worker(
    'email-queue',
    async (job: Job) => {
        const { emailId, recipient, subject, body, userId, minDelay, hourlyLimit } = job.data;

        // 1. Fetch from DB for strict idempotency check
        const email = await prisma.email.findUnique({
            where: { id: emailId },
            include: { job: true }
        });

        if (!email || email.status === 'SENT') {
            console.log(`Email ${emailId} already sent or missing. Skipping.`);
            return;
        }

        // 2. Production Rate Limiting (Redis-backed Hourly)
        const now = new Date();
        const currentHourKey = now.toISOString().slice(0, 13); // YYYY-MM-DDTHH
        const rateKey = `email_rate:${userId}:${currentHourKey}`;

        const currentCount = await connection.incr(rateKey);
        if (currentCount === 1) await connection.expire(rateKey, 7200);

        if (currentCount > (hourlyLimit || MAX_EMAILS_PER_HOUR)) {
            console.log(`Rate limit reached for user ${userId}. Rescheduling to next hour.`);
            const nextHour = new Date(now);
            nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
            await job.moveToDelayed(nextHour.getTime(), job.token as string);
            return;
        }

        // 3. Minimum Delay Enforcement
        const lastSentKey = `last_sent:${userId}`;
        const lastSentAt = await connection.get(lastSentKey);
        if (lastSentAt) {
            const timeDiff = Date.now() - parseInt(lastSentAt);
            if (timeDiff < (minDelay || MIN_DELAY_MS)) {
                const wait = (minDelay || MIN_DELAY_MS) - timeDiff;
                await job.moveToDelayed(Date.now() + wait, job.token as string);
                return;
            }
        }

        // 4. Update internal job status to ACTIVE
        await prisma.emailJob.update({
            where: { emailId },
            data: { status: 'SENDING', bullmqJobId: job.id }
        });

        // 5. Processing (Mock or Real SMTP)
        try {
            if (!process.env.ETHEREAL_EMAIL || !process.env.ETHEREAL_PASS) {
                console.log(`[MOCK] Sending to ${recipient}`);
                await new Promise(r => setTimeout(r, 500));
            } else {
                await transporter.sendMail({
                    from: `"Sender" <${process.env.ETHEREAL_EMAIL}>`,
                    to: recipient,
                    subject: subject,
                    text: body,
                });
            }

            // 6. Final DB Commit (Source of Truth)
            await prisma.email.update({
                where: { id: emailId },
                data: { status: 'SENT', sentAt: new Date() }
            });
            await prisma.emailJob.update({
                where: { emailId },
                data: { status: 'COMPLETED' }
            });

            await connection.set(lastSentKey, Date.now().toString());

        } catch (error: any) {
            console.error(`Send error for email ${emailId}:`, error.message);
            await prisma.email.update({
                where: { id: emailId },
                data: { status: 'FAILED' }
            });
            await prisma.emailJob.update({
                where: { emailId },
                data: { status: 'ERROR' }
            });
            throw error;
        }
    },
    {
        connection: connection as any,
        concurrency: parseInt(process.env.WORKER_CONCURRENCY || '5')
    }
);
