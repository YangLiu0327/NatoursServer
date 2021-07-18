const crypto = require('crypto')
const jwt = require('jsonwebtoken')
const { promisify } = require('util')
const User = require('../models/userModel')
const catchAsync = require('../utils/catchAsync')
const AppError = require('../utils/appError')
const Email = require('../utils/email')

// eslint-disable-next-line arrow-body-style
const signToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  })
}

// Create and send token to user
// Cookie used to identify user identity and save history by websites
const createSendToken = (user, statusCode, res) => {
  const token = signToken(user._id)
  const cookieOptions = {
    expires: new Date(
      // Convert to milliseconds
      Date.now() + process.env.JWT_COOKIE_EXPIRES_IN * 24 * 60 * 60 * 1000
    ),
    // Cannot modified or accessed by browser
    // httpOnly: true,
    // secure: true,
    // sameSite: 'none',
  }

  // Cookie will only be sent on an encrypted connection (Https)
  if (process.env.NODE_ENV === 'production') cookieOptions.secure = true

  res.cookie('jwt', token, cookieOptions)

  // Remove password from output
  user.password = undefined

  res.status(statusCode).json({
    status: 'success',
    token,
    data: {
      user,
    },
  })
}

// Sign up a new user
exports.signup = catchAsync(async (req, res, next) => {
  // Get info from req and then generate a new token for this user
  const newUser = await User.create({
    name: req.body.name,
    email: req.body.email,
    password: req.body.password,
    passwordConfirm: req.body.passwordConfirm,
  })
  const url = `http://127.0.0.1:8000/me`
  console.log(url)
  await new Email(newUser, url).sendWelcome()

  createSendToken(newUser, 201, res)
})

exports.login = catchAsync(async (req, res, next) => {
  // Get email and password from req
  const { email, password } = req.body

  // Check if email and password exist
  if (!email || !password) {
    return next(new AppError('Please provide email and password!', 400))
  }
  // Check if user exists && password is correct
  const user = await User.findOne({ email }).select('+password')

  // If user is not exist or password is not matched
  if (!user || !(await user.correctPassword(password, user.password))) {
    return next(new AppError('Incorrect email or password', 401))
  }

  // If everthing is ok, send token to client
  createSendToken(user, 200, res)
})

exports.logout = (req, res) => {
  res.cookie('jwt', 'loggedout', {
    expires: new Date(Date.now() + 10 * 1000),
    // httpOnly: true,
  })
  res.status(200).json({ status: 'success' })
}

exports.protect = catchAsync(async (req, res, next) => {
  // Getting token and check of it's exist
  let token
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    // Bearer weaeawedwad(token)
    token = req.headers.authorization.split(' ')[1]
  } else if (req.cookies.jwt) {
    token = req.cookies.jwt
  }

  if (!token) {
    return next(
      new AppError('You are not logged in! Please log in to get access', 401)
    )
  }
  // Verification token Check token is valid or not
  // If someone changed the token or if the token has already expired
  // { id: '60d308dcd3bd0e30408c2443', iat: 1624443125, exp: 1632219125 }
  const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET)
  console.log(decoded)

  // Check if user still exists
  const freshUser = await User.findById(decoded.id)
  if (!freshUser) {
    return next(
      new AppError('The user belonging to this token does no longer exist', 401)
    )
  }

  // Check if user changed password after the token was issued
  if (freshUser.changedPasswordAfter(decoded.iat)) {
    return next(
      new AppError('User recently changed password! Please log in again', 401)
    )
  }

  // Grant Access to Protected route
  req.user = freshUser
  next()
})

// Only for rendered pages, no errors
exports.isLoggedIn = async (req, res, next) => {
  if (req.cookies.jwt) {
    try {
      // 1) verify token
      const decoded = await promisify(jwt.verify)(
        req.cookies.jwt,
        process.env.JWT_SECRET
      )

      // 2) Check if user still exists
      const currentUser = await User.findById(decoded.id)
      if (!currentUser) {
        return next()
      }

      // 3) Check if user changed password after the token was issued
      if (currentUser.changedPasswordAfter(decoded.iat)) {
        return next()
      }

      // THERE IS A LOGGED IN USER
      res.locals.user = currentUser
      return next()
    } catch (err) {
      return next()
    }
  }
  next()
}

// Restrict to specific roles
exports.restrictTo =
  (...roles) =>
  (req, _res, next) => {
    // roles ['admin', 'lead-guide']
    if (!roles.includes(req.user.role)) {
      return next(
        new AppError('You do not have permission to perfom this action', 403)
      )
    }
    next()
  }

exports.forgotPassword = catchAsync(async (req, res, next) => {
  // Get user based on POSTed email
  const user = await User.findOne({ email: req.body.email })

  if (!user) {
    return next(new AppError('There is no user with this email address', 404))
  }

  // Generate the random reset token
  const resetToken = user.createPasswordResetToken()
  // Only modified token and hence there is no email and name which are required
  // turn validateBeforeSave to false in order to only save the new token
  await user.save({ validateBeforeSave: false })

  // Send it to user's email
  try {
    const resetURL = `${req.protocol}://${req.get(
      'host'
    )}/api/v1/users/resetPassword/${resetToken}`
    await new Email(user, resetURL).sendPasswordReset()

    res.status(200).json({
      status: 'success',
      message: 'Token sent to email',
    })
  } catch (err) {
    console.log(err)
    // Reset token and expire to undefined as error occured
    user.passwordResetToken = undefined
    user.passwordResetExpires = undefined
    await user.save({ validateBeforeSave: false })

    return next(
      new AppError('There was an error sending the email. Try again later', 500)
    )
  }
})

exports.resetPassword = catchAsync(async (req, res, next) => {
  // Get user based on the token
  const hashedToken = crypto
    .createHash('sha256')
    .update(req.params.token)
    .digest('hex')

  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() },
  })
  // If token has not expired, and there is a user, set the new password
  if (!user) {
    return next(new AppError('Token is invalid or has expired', 400))
  }

  // Update changePasswordAt property for the user
  user.password = req.body.password
  user.passwordConfirm = req.body.passwordConfirm
  user.passwordResetToken = undefined
  user.passwordResetExpires = undefined
  await user.save()

  // Log the user in, send JWT
  createSendToken(user, 200, res)
})

exports.updatePassword = catchAsync(async (req, res, next) => {
  // Get user from collection
  console.log(req.body)
  const user = await User.findById(req.body.id).select('+password')

  // Check if POSTed current password is correct
  if (!(await user.correctPassword(req.body.currentPassword, user.password))) {
    return next(new AppError('Your current password is wrong', 401))
  }

  // If so, update password
  user.password = req.body.newPassword
  user.passwordConfirm = req.body.confirmedPassword
  await user.save()
  // User.findByIdAndUpdate will NOT work as intended

  // Log user in, send JWT
  createSendToken(user, 200, res)
})
