const mysql = require('mysql');
const config = require('../../config/config');
const connection = mysql.createConnection(config.SQL);
const crypto = require('crypto');
const secret = config.KEY.secret;
const jwt_secret = config.KEY.jwt_secret;
const jwt = require('jsonwebtoken');
const {transporter} = require("../../config/email");
const query = require("../../config/query");
const ApiError = require("../error/api-error");
const utils = require("../../util/utils");


function createAccessToken (user_id, user_role) {
    return new Promise((resolve, reject) => {
        jwt.sign(
            {
                id: user_id,
                role: user_role
            },
            jwt_secret,
            {
                expiresIn: '1m',
                issuer: 'Beagle',
                subject: 'accessToken'
            },
            (err, accessToken) => {
                if (err) reject(err)
                resolve(accessToken)
            }
        )
    })
}

function setRefreshToken(user_id, user_role) {
    return new Promise((resolve, reject) => {
      jwt.sign(
          {
              id: user_id,
              role: user_role
          },
          jwt_secret,
          {
              expiresIn: '24h',
              issuer: 'Beagle',
              subject: 'refreshToken'
          },
          (err, refreshToken) => {
              if (err) reject(err)
              const updateRefreshTokenQuery = query.updateQuery('user', {'user_token': refreshToken}, {'user_id': user_id});
              connection.query(updateRefreshTokenQuery, function (error, results) {
                  if (error) {
                      reject(error)
                  }
                  resolve(refreshToken)
              })
          }
      )
    })
}

function getRefreshToken(user_id) {
    let refreshToken = null;
    let user_role = null;
    const selectTokenQuery = query.selectQuery('user', ['user_token', 'user_role'], {'user_id': user_id})
    return new Promise((resolve, reject) => {
        connection.query(selectTokenQuery, function (error, results) {
            if (error) {
                console.log('Get refresh token from db failed')
                reject({
                    'status': 400,
                    'msg': 'Get refresh token from db failed'
                })
            }
            else if (results.length > 0) {
                refreshToken = results[0].user_token;
                user_role = results[0].user_role;
                const checkToken = new Promise(((resolve, reject) => {
                    jwt.verify(refreshToken, jwt_secret, function (err, decoded) {
                        if (err) {
                            reject(err)
                        }
                        else {
                            resolve(refreshToken)
                        }
                    })
                }))
                checkToken.then(
                    (refreshToken) => {
                        console.log('Refresh token is valid')
                        createAccessToken(user_id, user_role).then(
                            (accessToken) => {
                                resolve({
                                    'status': 200,
                                    'msg': 'Reissuing the access token',
                                    'data': {
                                        'id': user_id,
                                        'role': user_role,
                                        'accessToken': accessToken,
                                    }
                                })
                            },
                            (err) => {
                                console.log(`Error occurred while reissuing the access token: ${err}`)
                                reject({
                                    'status': 400,
                                    'msg': `Error occurred while reissuing the access token.`,
                                })
                            }
                        )
                    },
                    (err) => {
                        console.log(`Refresh token is invalid`)
                        reject({
                            'status': 400,
                            'msg': `Both token is invalid. Please login again.`,
                        })
                    }
                )
            }
            else {
                console.log(`Access token is invalid and Refresh token is null`)
                reject({
                    'status': 400,
                    'msg': `Access token is invalid and Refresh token is null. Please login again`,
                })
            }
        });
    });
}

let generateRandom = (min, max) => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

exports.emailAuth = async (req, res, next) => {
    const number = generateRandom(111111, 999999);
    const {email} = req.body;
    let email_form = require('../../views/email-form.js').form;
    const email_form_new = email_form.replace("$authNum", number)
    const mailOptions = {
        from: 'chldusdn20@gmail.com',
        to: email,
        subject: "[Vada]?????? ?????? ????????? ?????????.",
        html: email_form_new
    }
    const selectQuery = query.selectQuery('user', ['user_id'], {'user_id': email});
    connection.query(selectQuery, async function (error, check_result, fields) {
        if (error) {
            next(ApiError.badRequest('There is a problem with the server. Please try again in a few minutes.'));
            return;
        }
        if (check_result.length > 0) {
            next(ApiError.badRequest('Email is already registered'));
        } else {
            const result = await transporter.sendMail(mailOptions, (error, response) => {
                if (error) {
                    console.log(`Error occurred while sending member registration verification email for sign up : ${error}`)
                    next(ApiError.badRequest('There is a problem with the server. Please try again in a few minutes.'));
                } else {
                    res.status(200).json({
                        'status': 200,
                        'msg': 'Successfully sending verification code by e-mail',
                        'data': {
                            'id': email,
                            'role': 'user',
                            'authNum': number,
                        }
                    })
                }
                transporter.close();
            })
        }
    })
}

exports.emailCheck = async (req, res, next) => {
    const number = generateRandom(111111, 999999);
    const {email} = req.body;
    let email_form = require('../../views/email-form.js').form;
    const email_form_new = email_form.replace("$authNum", number)
    const mailOptions = {
        from: 'chldusdn20@gmail.com',
        to: email,
        subject: "[Vada]?????? ?????? ????????? ?????????.",
        html: email_form_new
    }
    const selectQuery = query.selectQuery('user', ['user_id'], {'user_id': email});
    connection.query(selectQuery, async function (error, check_result, fields) {
        if (error) {
            next(ApiError.badRequest('There is a problem with the server. Please try again in a few minutes.'));
            return;
        }
        if (check_result.length === 0) {
            next(ApiError.badRequest('Email is not registered'));
        } else {
            const result = await transporter.sendMail(mailOptions, (error, response) => {
                if (error) {
                    console.log(`Error occurred while sending member registration verification email for reset pwd : ${error}`)
                    next(ApiError.badRequest('There is a problem with the server. Please try again in a few minutes.'));
                } else {
                    res.status(200).json({
                        'status': 200,
                        'msg': 'Successfully sending verification code by e-mail',
                        'data': {
                            'id': email,
                            'role': 'user',
                            'authNum': number,
                        }
                    })
                }
                transporter.close();
            })
        }
    })
}

exports.login = (req, res, next) => {
    // ????????? ??????
    const user_id = req.body.id;
    const user_pwd = req.body.pwd;
    let user_role = null;

    if (user_id) {
        const selectQuery = query.selectQuery('user', ['user_pwd', 'user_role'], {'user_id': user_id});
        connection.query(selectQuery, function (error, results) {
            if (error) {
                console.log(error)
                next(ApiError.badRequest('There is a problem with the server. Please try again in a few minutes.'));
                return;
            }
            if (results.length > 0) {
                console.log(results);

                const hash = crypto.createHmac('sha256', secret)
                    .update(user_pwd)
                    .digest('base64');

                user_role = results[0].user_role;

                if (hash === results[0].user_pwd) {
                    createAccessToken(user_id, user_role).then(
                        (accessToken) => {
                            setRefreshToken(user_id, user_role).then(
                                (refreshToken) => {
                                    checkTempPwdUser(user_id).then(
                                        isTempUser => {
                                            res.status(200).json({
                                                'status': 200,
                                                'msg': 'Login success',
                                                'data': {
                                                    'id': user_id,
                                                    'role': user_role,
                                                    'accessToken': accessToken,
                                                    'isTempUser': isTempUser
                                                }
                                            });
                                        },
                                        err => {
                                            next(ApiError.badRequest(err));
                                        }
                                    )
                                },
                                (err) => {
                                    console.log('Login failure during setting refresh token');
                                    next(ApiError.badRequest('There is a problem with the server. Please try again in a few minutes.'));
                                }
                            )
                        },
                        (err) => {
                            console.log(err)
                            next(ApiError.badRequest('Login failure'));
                        }
                    )
                } else {
                    next(ApiError.badRequest('Wrong password'));
                }
            } else {
                console.log('Email is not registered');
                next(ApiError.badRequest('Email is not registered'));
            }
        });
    } else {
        next(ApiError.badRequest('Please input email'));
    }
};

exports.check = (req, res, next) => {
    // ?????? ??????
    const user_id = req.body.id;
    let accessToken = req.headers['x-access-token'];
    if (accessToken) {
        this.checkLogin(user_id, accessToken).then(
            payload => {
                console.log('Access token is valid')
                res.status(200).json({
                    'status': 200,
                    'msg': 'Access token is valid',
                    'data': {
                        'id': user_id,
                        'role': payload.role,
                        'accessToken': accessToken,
                    }
                })
            },
            isUserNotMatchErr => {
                if (isUserNotMatchErr) {
                    console.log('user_id and id from accessToken is not matched')
                    next(ApiError.badRequest('Invalid access. Please logout and try again.'));
                } else {
                    getRefreshToken(user_id).then(
                        (result) => {
                            console.log('Invalid access token but valid refresh token')
                            res.status(200).json(result);
                        },
                        (error) => {
                            console.log('Both access token and refresh token are invalid')
                            next(ApiError.badRequest('Access token is invalid'));
                        }
                    )
                }
            }
        )
    } else {
        getRefreshToken(user_id).then(
            (result) => {
                console.log('Reissuing access token')
                res.status(200).json(result);
            },
            (error) => {
                console.log('Reissuing access token failure')
                next(ApiError.badRequest(error.msg));
            }
        )
    }
};

exports.isAdmin = (req, res, next) => {
    const {id} = req.body;
    let accessToken = req.headers['x-access-token'];
    if (accessToken) {
        this.checkAdmin(id, accessToken).then(
            isAdmin => {
                res.status(200).json({
                    'status': 200,
                    'msg': 'check admin success',
                    'data': {
                        'isAdmin': isAdmin
                    }
                });
            },
            err => {
                next(ApiError.badRequest(err))
            }
        )
    }
    else {
        res.status(200).json({
            'status': 200,
            'msg': 'please log in',
            'data': {
                'isAdmin': false
            }
        });
    }
}

exports.isLogin = (req, res, next) => {
    const user_id = req.body.id;
    let accessToken = req.headers['x-access-token'];
    if (user_id && accessToken) {
        this.checkLogin(user_id, accessToken).then(
            payload => {
                console.log('Access token is valid')
                res.status(200).json({
                    'status': 200,
                    'msg': 'Access token is valid',
                    'data': {
                        'isLogin': true
                    }
                })
            },
            isUserNotMatchErr => {
                if (isUserNotMatchErr) {
                    console.log('user_id and id from accessToken is not matched')
                    next(ApiError.badRequest('Invalid access. Please logout and try again.'));
                } else {
                    console.log('Access token is invalid')
                    res.status(200).json({
                        'status': 200,
                        'msg': 'Access token is inValid',
                        'data': {
                            'isLogin': false
                        }
                    })
                }
            }
        )
    }
    else {
        res.status(200).json({
            'status': 200,
            'msg': 'User id or access token is null',
            'data': {
                'isLogin': false
            }
        })
    }
}

exports.checkLogin = (user_id, accessToken) => {
    let isUserNotMatched = false;
    return new Promise((resolve, reject) => {
        jwt.verify(accessToken, jwt_secret, function (err, decoded) {
            if (err) {
                reject(isUserNotMatched)
            }
            else {
                let payload = utils.parseJwt(accessToken)
                if (payload.id === user_id) {
                    resolve(payload)
                } else {
                    isUserNotMatched = true;
                    reject(isUserNotMatched)
                }
            }
        });
    });
}

exports.checkAdmin = (id, accessToken) => {
    return new Promise((resolve, reject) => {
        const checkToken = new Promise((resolve, reject) => {
            jwt.verify(accessToken, jwt_secret, function (err, decoded) {
                if (err) {
                    reject('Access token is invalid')
                } else{
                    resolve(accessToken);
                }
            });
        });
        checkToken.then(
            token => {
                let payload = utils.parseJwt(token)
                if (payload.id === id) {
                    const selectQuery = `select (select user_role from user where user_id = "${id}") = "admin" as "isAdmin"`
                    connection.query(selectQuery, async function (error, results) {
                        if (error) {
                            console.log(error);
                            reject('check is admin failure');
                            return;
                        }
                        if (results.length > 0) {
                            console.log(`check is admin success : ${results[0].isAdmin}`)
                            resolve(results[0].isAdmin === 1)
                        }
                        else {
                            console.log('This id is not registered');
                            reject('This id is not registered')
                        }
                    })
                } else {
                    reject('Invalid access. Please logout and try again.')
                }
            },
            err => {
                reject('Invalid access. Please logout and try again.');
            }
        )
    })
}

exports.checkTempUser = (email) => {
    return checkTempPwdUser(email)
}

function checkTempPwdUser(email) {
    return new Promise(((resolve, reject) => {
        const checkTempUserQuery = query.selectQuery('user', ['user_reset'], {'user_id': email})
        connection.query(checkTempUserQuery, function (error, results) {
            if (error) {
                console.log(`Error occurred during reset password : ${error}`);
                reject('There is a problem with the server. Please try again in a few minutes.')
            }
            else if (results.length > 0) {
                const isTempUser = results[0]['user_reset'];
                if (isTempUser === 1) {
                    resolve(true)
                }
                else {
                    console.log('This user does not have a temporary password.')
                    resolve(false)
                }
            }
            else {
                console.log('This email is not registered')
                reject('This email is not registered')
            }
        })
    }))
}