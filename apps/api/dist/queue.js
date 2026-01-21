"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.emailWorker = exports.emailQueue = void 0;
const bullmq_1 = require("bullmq");
const redis_1 = require("./redis");
const client_1 = require("@prisma/client");
const nodemailer_1 = __importDefault(require("nodemailer"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const prisma = new client_1.PrismaClient();
exports.emailQueue = new bullmq_1.Queue('email-queue', { connection: redis_1.connection });
const transporter = nodemailer_1.default.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    auth: {
        user: process.env.ETHEREAL_EMAIL,
        pass: process.env.ETHEREAL_PASS,
    },
});
const MIN_DELAY_MS = parseInt(process.env.MIN_DELAY_MS || '2000');
const MAX_EMAILS_PER_HOUR = 200; // Can be env or per user config
exports.emailWorker = new bullmq_1.Worker('email-queue', async (job) => {
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
    const currentCount = await redis_1.connection.incr(rateKey);
    if (currentCount === 1)
        await redis_1.connection.expire(rateKey, 7200);
    if (currentCount > (hourlyLimit || MAX_EMAILS_PER_HOUR)) {
        console.log(`Rate limit reached for user ${userId}. Rescheduling to next hour.`);
        const nextHour = new Date(now);
        nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
        await job.moveToDelayed(nextHour.getTime(), job.token);
        return;
    }
    // 3. Minimum Delay Enforcement
    const lastSentKey = `last_sent:${userId}`;
    const lastSentAt = await redis_1.connection.get(lastSentKey);
    if (lastSentAt) {
        const timeDiff = Date.now() - parseInt(lastSentAt);
        if (timeDiff < (minDelay || MIN_DELAY_MS)) {
            const wait = (minDelay || MIN_DELAY_MS) - timeDiff;
            await job.moveToDelayed(Date.now() + wait, job.token);
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
        }
        else {
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
        await redis_1.connection.set(lastSentKey, Date.now().toString());
    }
    catch (error) {
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
}, {
    connection: redis_1.connection,
    concurrency: parseInt(process.env.WORKER_CONCURRENCY || '5')
});
