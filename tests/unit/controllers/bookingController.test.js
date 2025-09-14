const BookingController = require('../../../src/controllers/bookingController');
const { Booking, Event, User, sequelize } = require('../../../src/models');
const { Op } = require('sequelize');
const QRCode = require('qrcode');

jest.mock('../../../src/models');
jest.mock('qrcode');
const analyticsService = require('../../../src/services/analyticsService');

afterAll(() => {
  analyticsService.stopBroadcasting(); // or .stop() or .destroy() method you implemented for cleanup
});



describe('BookingController', () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      body: {},
      params: {},
      query: {},
      user: { id: 1 },
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn();

    // Clear mocks
    jest.clearAllMocks();
  });

  // Sanity check
  it('Sanity check', () => {
    expect(true).toBe(true);
  });

  // -------------------- selectSeats --------------------
  describe('selectSeats', () => {
    it('should return 404 if event not found', async () => {
      req.body.eventId = 999;
      Event.findByPk.mockResolvedValue(null);

      await BookingController.selectSeats(req, res, next);

      expect(next).toHaveBeenCalled();
      const error = next.mock.calls[0][0];
      expect(error.statusCode || error.status).toBe(404);
      expect(error.message).toBe('Event not found');
    });

    it('should return 409 if seats unavailable', async () => {
      req.body = {
        eventId: 1,
        seatNumbers: ['A1', 'A2'],
        seatSection: 'GOLD',
        seatRow: 'A'
      };
      Event.findByPk.mockResolvedValue({ id: 1, price: 100 });
      BookingController.checkSeatAvailability = jest.fn().mockResolvedValue(['A1']);

      await BookingController.selectSeats(req, res, next);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Some seats are no longer available',
        unavailableSeats: ['A1']
      });
    });

    it('should create booking and return 201', async () => {
      req.body = {
        eventId: 1,
        seatNumbers: ['A1', 'A2'],
        seatSection: 'GOLD',
        seatRow: 'A'
      };
      Event.findByPk.mockResolvedValue({ id: 1, price: 100 });
      BookingController.checkSeatAvailability = jest.fn().mockResolvedValue([]);
      Booking.create.mockResolvedValue({
        id: 1,
        bookingNumber: 'BKG123',
        seatNumbers: ['A1', 'A2'],
        totalAmount: 200,
        reservationExpiresAt: new Date()
      });
      sequelize.transaction.mockImplementation(fn => fn({ commit: jest.fn(), rollback: jest.fn() }));

      await BookingController.selectSeats(req, res, next);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        message: expect.stringContaining('Seats selected')
      }));
    });
  });

  // -------------------- confirmBooking --------------------
  describe('confirmBooking', () => {
    it('should return 404 if booking not found', async () => {
      req.params.bookingId = 1;
      Booking.findOne.mockResolvedValue(null);

      await BookingController.confirmBooking(req, res, next);

      expect(next).toHaveBeenCalled();
      const error = next.mock.calls[0][0];
      expect(error.statusCode || error.status).toBe(404);
      expect(error.message).toBe('Booking not found or expired');
    });

    it('should return 410 if booking expired', async () => {
      req.params.bookingId = 1;
      const expiredDate = new Date(Date.now() - 1000);
      Booking.findOne.mockResolvedValue({
        id: 1,
        reservationExpiresAt: expiredDate,
        update: jest.fn(),
        status: 'SEAT_SELECTED'
      });

      await BookingController.confirmBooking(req, res, next);

      expect(next).toHaveBeenCalled();
      const error = next.mock.calls[0][0];
      expect(error.statusCode || error.status).toBe(410);
      expect(error.message).toBe('Booking expired');
    });

    it('should confirm booking successfully', async () => {
      req.params.bookingId = 1;
      req.body = { paymentMethod: 'CARD', paymentDetails: {} };
      Booking.findOne.mockResolvedValue({
        id: 1,
        userId: 1,
        bookingNumber: 'BKG123',
        eventId: 1,
        totalAmount: 200,
        seatNumbers: ['A1', 'A2'],
        status: 'SEAT_SELECTED',
        reservationExpiresAt: new Date(Date.now() + 10000),
        update: jest.fn(),
        event: { id: 1, name: 'Concert', venue: 'Stadium', dateTime: new Date() }
      });
      QRCode.toDataURL.mockResolvedValue('qrCodeData');
      sequelize.transaction.mockImplementation(fn => fn({ commit: jest.fn(), rollback: jest.fn() }));
      BookingController.processPayment = jest.fn().mockResolvedValue({ success: true, paymentId: 'PAY123' });
      BookingController.generateTicketHash = jest.fn().mockReturnValue('hash123');

      await BookingController.confirmBooking(req, res, next);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        message: expect.stringContaining('Booking confirmed')
      }));
    });
  });

  // -------------------- getSeatMap --------------------
  describe('getSeatMap', () => {
    it('should return 404 if event not found', async () => {
      req.params.eventId = 1;
      Event.findByPk.mockResolvedValue(null);

      await BookingController.getSeatMap(req, res, next);

      expect(next).toHaveBeenCalled();
      const error = next.mock.calls[0][0];
      expect(error.statusCode || error.status).toBe(404);
      expect(error.message).toBe('Event not found');
    });

    it('should return seat map', async () => {
      req.params.eventId = 1;
      Event.findByPk.mockResolvedValue({ id: 1, name: 'Concert', price: 100 });
      Booking.findAll.mockResolvedValue([
        { seatNumbers: ['A1'], seatSection: 'PREMIUM', seatRow: 'A', status: 'CONFIRMED' }
      ]);

      await BookingController.getSeatMap(req, res, next);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({ seatMap: expect.any(Object) })
      }));
    });
  });

  // -------------------- cancelBooking --------------------
  describe('cancelBooking', () => {
    it('should return 404 if booking not found', async () => {
      req.params.bookingId = 1;
      Booking.findOne.mockResolvedValue(null);

      await BookingController.cancelBooking(req, res, next);

      expect(next).toHaveBeenCalled();
      const error = next.mock.calls[0][0];
      expect(error.statusCode || error.status).toBe(404);
      expect(error.message).toBe('Booking not found');
    });

    it('should cancel booking successfully', async () => {
      req.params.bookingId = 1;
      const mockBooking = { update: jest.fn(), id: 1 };
      Booking.findOne.mockResolvedValue(mockBooking);
      sequelize.transaction.mockImplementation(fn => fn({ commit: jest.fn(), rollback: jest.fn() }));

      await BookingController.cancelBooking(req, res, next);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        message: 'Booking cancelled successfully'
      }));
    });
  });

  // -------------------- getUserBookings --------------------
  describe('getUserBookings', () => {
    it('should return user bookings with pagination', async () => {
      Booking.findAndCountAll.mockResolvedValue({
        rows: [
          {
            id: 1,
            bookingNumber: 'BKG123',
            status: 'CONFIRMED',
            seatNumbers: ['A1'],
            totalAmount: 100,
            qrCode: 'qrCodeData',
            event: { id: 1, name: 'Concert' }
          }
        ],
        count: 1
      });

      await BookingController.getUserBookings(req, res, next);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          bookings: expect.any(Array),
          pagination: expect.any(Object)
        })
      }));
    });
  });
});
