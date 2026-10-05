import { env, isTest } from '@farmgo/config';
import nodemailer, { type Transporter } from 'nodemailer';
import { logger } from '../logger.js';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

let transporter: Transporter | undefined;

function getTransporter(): Transporter {
  transporter ??= isTest
    ? nodemailer.createTransport({ jsonTransport: true })
    : nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_PORT === 465,
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
      });
  return transporter;
}

export async function sendEmail(msg: EmailMessage): Promise<void> {
  const info = await getTransporter().sendMail({ from: env.EMAIL_FROM, ...msg });
  logger.debug({ to: msg.to, subject: msg.subject, id: info.messageId }, 'email sent');
}
