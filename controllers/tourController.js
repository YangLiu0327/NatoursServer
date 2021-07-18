const multer = require('multer')
const sharp = require('sharp')
const Tour = require('../models/tourModel')
const AppError = require('../utils/appError')
const catchAsync = require('../utils/catchAsync')
const factory = require('./handlerFactory')

const multerStorage = multer.memoryStorage()

const multerFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image')) {
    cb(null, true)
  } else {
    cb(new AppError('Not an image! Please upload only images', 400), false)
  }
}

const upload = multer({
  storage: multerStorage,
  fileFilter: multerFilter,
})

exports.uploadTourImages = upload.fields([
  { name: 'imageCover', maxCount: 1 },
  { name: 'images', maxCount: 3 },
])

// upload.single('image') req.file
// upload.array('images', 5) req.files

exports.resizeTourImages = catchAsync(async (req, res, next) => {
  if (!req.files.imageCover || !req.files.images) return next()

  // Cover image

  req.body.imageCover = `tour-${req.params.id}-${Date.now()}-cover.jpeg`
  await sharp(req.files.imageCover[0].buffer)
    .resize(2000, 1333)
    .toFormat('jpeg')
    .jpeg({ quality: 90 })
    .toFile(`public/img/tours/${req.body.imageCover}`)

  // Images
  req.body.images = []

  await Promise.all(
    req.files.images.map(async (file, i) => {
      const filename = `tour-${req.params.id}-${Date.now()}-${i + 1}.jpeg`

      await sharp(file.buffer)
        .resize(2000, 1333)
        .toFormat('jpeg')
        .jpeg({ quality: 90 })
        .toFile(`public/img/tours/${filename}`)

      req.body.images.push(filename)
    })
  )
  next()
})

// Pick the top 5 tours
exports.aliasTopTours = (req, res, next) => {
  req.query.limit = '5'
  // Dec order for ratingsAvaerage and acc for price if the prior is same
  req.query.sort = '-ratingsAverage,price'
  req.query.fields = 'name,price,ratingsAverage,summary,difficulty'
  next()
}

exports.getAllTours = factory.getAll(Tour)
exports.getTour = factory.getOne(Tour, { path: 'reviews' })
exports.createTour = factory.createOne(Tour)
exports.updateTour = factory.updateOne(Tour)
exports.deleteTour = factory.deleteOne(Tour)

exports.getTourStatus = catchAsync(async (req, res, next) => {
  const stats = await Tour.aggregate([
    {
      // Filters the documents to pass only the documents
      // that match the specified condition
      $match: { ratingsAverage: { $gte: 4.5 } },
    },
    {
      // Groups input documents by the specified _id expression
      // and for each distinct grouping, outputs a document.
      $group: {
        // group by difficulty
        _id: '$difficulty',
        // add 1 every time when count the sum of tours
        numTours: { $sum: 1 },
        numRatings: { $sum: '$ratingsQuantity' },
        avgRating: { $avg: '$ratingsAverage' },
        avgPrice: { $avg: '$price' },
        minPrice: { $min: '$price' },
        maxPrice: { $max: '$price' },
      },
    },
    {
      // sort by avgPrice one by one
      $sort: { avgPrice: 1 },
    },
    // {
    //   // $ne not equal
    //   $match: { _id: { $ne: 'easy' } },
    // },
  ])

  res.status(200).json({
    status: 'success',
    data: {
      stats,
    },
  })
})

exports.getMonthlyPlan = catchAsync(async (req, res, next) => {
  const year = req.params.year * 1 // 2021
  const plan = await Tour.aggregate([
    {
      // 拆分(unwind)可以将数组中的每一个值拆分为单独的文档。
      $unwind: '$startDates',
    },
    {
      // Filters the documents to pass only the documents that match the condition
      $match: {
        startDates: {
          $gte: new Date(`${year}-01-01`),
          $lte: new Date(`${year}-12-31`),
        },
      },
    },
    {
      $group: {
        // $month: Returns the month of a date as a number between 1 and 12
        _id: { $month: '$startDates' },
        numTourStarts: { $sum: 1 },
        // The $push operator appends a specified value to an array.
        tours: { $push: '$name' },
      },
    },
    {
      // add extra field
      $addFields: { month: '$_id' },
    },
    {
      // don't show _id
      // 0 not show
      // 1 show
      $project: {
        _id: 0,
      },
    },
    {
      // sort by numTourStarts by decending order
      $sort: { numTourStarts: -1 },
    },
    // only show 12 results
    {
      $limit: 12,
    },
  ])

  res.status(200).json({
    status: 'success',
    data: {
      plan,
    },
  })
})

// /tours-within/:distance/center/:latlng/unit/:unit
// tours-distance/233/center/34.111745,-118.113491/unit/mi
exports.getTourWithin = catchAsync(async (req, res, next) => {
  const { distance, latlng, unit } = req.params
  const [lat, lng] = latlng.split(',')

  const radius = unit === 'mi' ? distance / 3963.2 : distance / 6378.1

  if (!lat || !lng) {
    next(
      new AppError(
        'Please provide latitude and lonitude in the format lat, lng',
        400
      )
    )
  }

  const tours = await Tour.find({
    startLocation: { $geoWithin: { $centerSphere: [[lng, lat], radius] } },
  })

  res.status(200).json({
    status: 'success',
    results: tours.length,
    data: {
      data: tours,
    },
  })
})

exports.getDistances = catchAsync(async (req, res, next) => {
  const { latlng, unit } = req.params
  const [lat, lng] = latlng.split(',')

  const multiplier = unit === 'mi' ? 0.000621371 : 0.001

  if (!lat || !lng) {
    next(
      new AppError(
        'Please provide latitude and lonitude in the format lat, lng',
        400
      )
    )
  }

  const distances = await Tour.aggregate([
    {
      $geoNear: {
        near: {
          type: 'Point',
          coordinates: [lng * 1, lat * 1],
        },
        distanceField: 'distance',
        distanceMultiplier: multiplier,
      },
    },
    {
      // Only show distance and name
      $project: {
        distance: 1,
        name: 1,
      },
    },
  ])

  res.status(200).json({
    status: 'success',
    data: {
      data: distances,
    },
  })
})
