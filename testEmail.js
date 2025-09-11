// testEmail.js
require('dotenv').config();
const emailService = require('./src/services/emailService');

(async () => {
  try {
    const testBooking = {
      id: 1,
      bookingNumber: 'TEST123',
      seatNumbers: ['A1', 'A2'],
      seatSection: 'Main',
      seatRow: 1,
      ticketCount: 2,
      currency: 'INR',
      totalAmount: 500,
      qrCode: null, // optional base64 string
      update: async (data) => console.log('Booking updated:', data)
    };

    const testEvent = {
      name: 'Test Event',
      venue: 'Test Venue',
      dateTime: new Date()
    };

    const testUser = {
      name: 'Ansh',
      email: 'wasan.ansh@gmail.com'
    };

    const result = await emailService.sendBookingConfirmation(testBooking, testEvent, testUser);
    console.log('Email result:', result);
  } catch (err) {
    console.error('Email test failed:', err);
  }
})();
