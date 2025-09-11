// src/services/emailService.js
const nodemailer = require('nodemailer');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

class EmailService {
  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD
      }
    });
  }

  async sendBookingConfirmation(booking, event, user) {
    try {
      const emailHtml = await this.generateBookingConfirmationHTML(booking, event, user);
      
      const mailOptions = {
        from: `"Evently" <${process.env.SMTP_FROM}>`,
        to: user.email,
        subject: `🎟️ Booking Confirmed: ${event.name}`,
        html: emailHtml,
        attachments: booking.qrCode ? [{
          filename: `ticket-${booking.bookingNumber}.png`,
          content: booking.qrCode.split(',')[1],
          encoding: 'base64',
          cid: 'qrticket'
        }] : []
      };

      const result = await this.transporter.sendMail(mailOptions);
      
      // Update booking email status
      await booking.update({ emailSent: true });
      
      logger.info('Booking confirmation email sent', {
        bookingId: booking.id,
        email: user.email,
        messageId: result.messageId
      });

      return { success: true, messageId: result.messageId };
    } catch (error) {
      logger.error('Email sending failed:', error);
      return { success: false, error: error.message };
    }
  }

  async generateBookingConfirmationHTML(booking, event, user) {
    const seatInfo = booking.seatNumbers ? 
      `Seats: ${booking.seatNumbers.join(', ')} (${booking.seatSection} - Row ${booking.seatRow})` :
      `General Admission: ${booking.ticketCount} ticket(s)`;

    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <title>Booking Confirmation</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f4f4f4; }
            .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; }
            .content { padding: 30px; }
            .booking-details { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; }
            .qr-section { text-align: center; margin: 30px 0; }
            .footer { background: #343a40; color: white; padding: 20px; text-align: center; }
            .btn { display: inline-block; padding: 12px 24px; background: #28a745; color: white; text-decoration: none; border-radius: 4px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🎉 Booking Confirmed!</h1>
                <p>Your tickets are ready</p>
            </div>
            
            <div class="content">
                <p>Hi ${user.name},</p>
                <p>Great news! Your booking has been confirmed. Here are your ticket details:</p>
                
                <div class="booking-details">
                    <h3>📋 Booking Details</h3>
                    <p><strong>Booking Number:</strong> ${booking.bookingNumber}</p>
                    <p><strong>Event:</strong> ${event.name}</p>
                    <p><strong>Venue:</strong> ${event.venue}</p>
                    <p><strong>Date & Time:</strong> ${new Date(event.dateTime).toLocaleString()}</p>
                    <p><strong>${seatInfo}</strong></p>
                    <p><strong>Total Amount:</strong> ${booking.currency} ${booking.totalAmount}</p>
                </div>

                ${booking.qrCode ? `
                <div class="qr-section">
                    <h3>📱 Your Digital Ticket</h3>
                    <img src="cid:qrticket" alt="QR Ticket" style="max-width: 200px;">
                    <p><small>Show this QR code at the venue entrance</small></p>
                </div>
                ` : ''}

                <p><strong>Important Instructions:</strong></p>
                <ul>
                    <li>Arrive 30 minutes before the event starts</li>
                    <li>Carry a valid ID for verification</li>
                    <li>No outside food or beverages allowed</li>
                </ul>
            </div>
            
            <div class="footer">
                <p>Need help? Contact us at support@evently.com</p>
                <p>© 2025 Evently. All rights reserved.</p>
            </div>
        </div>
    </body>
    </html>`;
  }

  async sendCancellationEmail(booking, event, user) {
    const emailHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #dc3545;">Booking Cancelled</h2>
        <p>Hi ${user.name},</p>
        <p>Your booking <strong>${booking.bookingNumber}</strong> for <strong>${event.name}</strong> has been cancelled.</p>
        <p>Refund will be processed within 5-7 business days.</p>
        <hr>
        <p><small>© 2025 Evently</small></p>
    </div>`;

    return await this.transporter.sendMail({
      from: `"Evently" <${process.env.SMTP_FROM}>`,
      to: user.email,
      subject: `Booking Cancelled: ${event.name}`,
      html: emailHtml
    });
  }
}

module.exports = new EmailService();
