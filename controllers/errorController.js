const AppError = require('../utils/appError')

const handleCastErrorDB = (err) => {
  const message = `Invalid ${err.path}: ${err.value}.`
  return new AppError(message, 400)
}

const handleDuplicateFieldsDB = (err) => {
  console.log(err)
  const value = err.keyValue.name
  const message = `Duplicate field value: ${value}. Please use another value`
  return new AppError(message, 400)
}

const handleValidationErrorDB = (err) => {
  const errors = Object.values(err.errors).map((item) => item.message)
  const message = `Invalid input data. ${errors.join('. ')}`
  return new AppError(message, 400)
}

const handleJWTError = () =>
  new AppError('Invalid token. Please log in again', 401)

const handleJWTExpiredError = () =>
  new AppError('Your token has expired! Please log in again', 401)

const sendErrorDev = (err, req, res) => {
  if (req.originalUrl.startsWith('/api')) {
    res.status(err.statusCode).json({
      status: err.status,
      error: err,
      message: err.message,
      stack: err.stack,
    })
  } else {
    res.status(err.statusCode).json({
      title: 'Something went wrong',
      msg: err.message,
    })
  }
}

const sendErrorProd = (err, res) => {
  // Operational, trusted error: send message to client
  if (err.isOperational) {
    res.status(err.statusCode).json({
      status: err.status,
      message: err.message,
    })
    // Programming or other unknown error: don't leak error details
  } else {
    // Log error
    console.error('Error', err)
    // Send genetic message
    res.status(500).json({
      status: 'error',
      message: 'Something went very wrong',
    })
  }
}

module.exports = (err, req, res, next) => {
  // 500 internal server error
  err.statusCode = err.statusCode || 500
  err.status = err.status || 'error'
  console.log(process.env.NODE_ENV)

  if (process.env.NODE_ENV === 'development') {
    sendErrorDev(err, req, res)
  } else if (process.env.NODE_ENV.trim() === 'production') {
    let error = { ...err }
    if (error.name === 'CastError') error = handleCastErrorDB(error)
    if (error.code === 11000) error = handleDuplicateFieldsDB(error)
    if (err.name === 'ValidationError') error = handleValidationErrorDB(error)
    if (err.name === 'JsonWebTokenError') error = handleJWTError(error)
    if (error.name === 'TokenExpiredError') error = handleJWTExpiredError(error)
    sendErrorProd(error, req, res)
  }
}
