"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const dotenv_1 = __importDefault(require("dotenv"));
const client_1 = require("@prisma/client");
const queue_1 = require("./queue");
const cors_1 = __importDefault(require("cors"));
const google_auth_library_1 = require("google-auth-library");
dotenv_1.default.config();
const client = new google_auth_library_1.OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3001;
const prisma = new client_1.PrismaClient();
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: '50mb' })); // Support large payloads for bulk scheduling
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date() });
});
// Real Google Login with token verification
app.post('/auth/google', async (req, res) => {
    const { token } = req.body;
    try {
        console.log('Verifying token with audience:', process.env.GOOGLE_CLIENT_ID);
        const ticket = await client.verifyIdToken({
            idToken: token,
            audience: process.env.GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        if (!payload) {
            console.error('Invalid token payload: no payload found');
            res.status(400).json({ error: 'Invalid token payload' });
            return;
        }
        console.log('Token verified for email:', payload.email);
        const { email, name, sub: googleId, picture: avatar } = payload;
        if (!email) {
            res.status(400).json({ error: 'Email not found in token' });
            return;
        }
        let user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
            user = await prisma.user.create({
                data: { email, name, googleId, avatar }
            });
        }
        else {
            // Update user info if it changed
            user = await prisma.user.update({
                where: { email },
                data: { name, googleId, avatar }
            });
        }
        res.json(user);
    }
    catch (error) {
        console.error('Auth error detail:', error.message || error);
        res.status(500).json({ error: 'Auth failed', details: error.message });
    }
});
// Schedule Emails with dynamic limits
app.post('/schedule', async (req, res) => {
    const { userId, emails, scheduledTime, minDelay, hourlyLimit } = req.body;
    if (!userId || !emails || !Array.isArray(emails)) {
        res.status(400).json({ error: 'Invalid payload' });
        return;
    }
    const delay = scheduledTime ? new Date(scheduledTime).getTime() - Date.now() : 0;
    try {
        // 1. Transactional Creation in DB (Strict Idempotency)
        const results = await prisma.$transaction(async (tx) => {
            const createdEmails = await Promise.all(emails.map((e) => tx.email.create({
                data: {
                    senderId: userId,
                    toEmail: e.recipient,
                    subject: e.subject,
                    body: e.body,
                    scheduledAt: scheduledTime ? new Date(scheduledTime) : new Date(),
                    status: 'SCHEDULED',
                }
            })));
            // 2. Map to EmailJobs for BullMQ tracking
            const emailJobs = await Promise.all(createdEmails.map((email) => tx.emailJob.create({
                data: {
                    emailId: email.id,
                    status: 'QUEUED'
                }
            })));
            return { createdEmails, emailJobs };
        });
        // 3. Add to Queue with dynamic campaign settings
        const queueJobs = results.createdEmails.map((email) => ({
            name: 'send-email',
            data: {
                emailId: email.id,
                userId: email.senderId,
                recipient: email.toEmail,
                subject: email.subject,
                body: email.body,
                minDelay: minDelay || 2000,
                hourlyLimit: hourlyLimit || 200
            },
            opts: {
                delay: Math.max(0, delay),
                jobId: email.id // Use Email ID for direct lookup
            }
        }));
        await queue_1.emailQueue.addBulk(queueJobs);
        res.json({ message: 'Scheduled', count: results.createdEmails.length });
    }
    catch (error) {
        console.error('Scheduling error:', error);
        res.status(500).json({ error: 'Scheduling failed' });
    }
});
// List Jobs (Updated for normalized schema)
app.get('/jobs', async (req, res) => {
    const { userId } = req.query;
    try {
        const emails = await prisma.email.findMany({
            where: { senderId: String(userId) },
            include: { job: true },
            orderBy: { createdAt: 'desc' },
            take: 100
        });
        res.json(emails);
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to fetch jobs' });
    }
});
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
