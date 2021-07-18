const Tour = require('../models/tourModel')
const Booking = require('../models/bookingModel')
const catchAsync = require('../utils/catchAsync')
// const AppError = require('../utils/appError')

exports.getOverview = catchAsync(async (req, res) => {
  // Get tour data from collection
  const tours = await Tour.find()
  // Build template

  // Render that template using tour data from collection
  res.status(200).render('overview', {
    title: 'All Tours',
    tours,
  })
})

exports.getMyTours = catchAsync(async (req, res, next) => {
  // Find all bookings
  console.log(req.params)
  const bookings = await Booking.find({ user: req.params.id })
  console.log(bookings)

  // Find tours with the returned IDs
  const tourIDs = bookings.map((item) => item.tour)
  const tours = await Tour.find({ _id: { $in: tourIDs } })

  res.status(200).json({ tours })
})

exports.getTour = catchAsync(async (req, res, next) => {
  const tour = await Tour.findOne({ slug: req.params.slug }).populate({
    path: 'reviews',
    fields: 'review rating user',
  })

  // return next(new AppError('There is no tour with that name', 404))
  if (!tour) {
    res.status(404).json({
      err: 'There is no tour with that name',
    })
  }
  res.status(200).json({ tour })
  // res.status(200).render('tour', {
  //   tour,
  // })
})
