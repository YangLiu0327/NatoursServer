/* eslint-disable camelcase */
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)
const Tour = require('../models/tourModel')
const Booking = require('../models/bookingModel')
const AppError = require('../utils/appError')
const catchAsync = require('../utils/catchAsync')
const factory = require('./handlerFactory')

exports.getCheckoutSession = catchAsync(async (req, res, next) => {
  // Get the currently booked toor
  const tour = await Tour.findById(req.params.tourId)

  // Create checkout session
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    success_url: `http://127.0.0.1:8000/?tour=${req.params.tourId}&user=${req.params.userId}&price=${tour.price}`,
    cancel_url: `http://127.0.0.1:8000/tour/${tour.slug}`,
    // customer_email: req.user.email,
    client_reference_id: req.params.tourId,
    line_items: [
      {
        name: `${tour.name} Tour`,
        description: tour.summary,
        images: [`https://www.natours.dev/img/tours/${tour.imageCover}`],
        amount: tour.price * 100,
        currency: 'usd',
        quantity: 1,
      },
    ],
  })
  const tour_id = req.params.tourId
  const user_id = req.params.userId
  const tour_price = tour.price

  if (!tour_id && !user_id && !tour_price) return next()
  await Booking.create({ tour: tour_id, user: user_id, price: tour_price })

  // res.redirect(req.originalUrl.split('?')[0])

  // Create session as response
  res.status(200).json({
    status: 'success',
    session,
  })
  res.redirect(req.originalUrl.split('?')[0])
})

exports.createBooking = factory.createOne(Booking)
exports.getBooking = factory.getOne(Booking)
exports.getAllBookings = factory.getAll(Booking)
exports.updateBooking = factory.updateOne(Booking)
exports.deleteBooking = factory.deleteOne(Booking)
