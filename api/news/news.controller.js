const mysql = require('mysql');
const config = require('../../config/config');
const connection = mysql.createConnection(config.SQL);
const jwt = require("jsonwebtoken");
const secret = config.KEY.secret;
const jwt_secret = config.KEY.jwt_secret;
const query = require('../../config/query')
const ApiError = require("../error/api-error");
const address = require('../../config/address').IP;

exports.test = (req, res, next) => {
    console.log(req.headers)
    res.status(200).json({
        body: req.body,
        files: req.files
    })
}

exports.create = (req, res, next) => {
    console.log('create news content called')
    const { title, content, id } = req.body;
    const files = req.files;
    const importance = (req.body.importance === 'true') ? 1 : 0;

    if (title && content && id) {
        const checkUserQuery = query.selectQuery('user', ['user_id'], {'user_id': id});
        connection.query(checkUserQuery, function (error, check_result, fields) {
            if (error) {
                console.log('Register content failure during check user id into db');
                next(ApiError.badRequest('There is a problem with the server. Please try again in a few minutes.'));
            }
            else if (check_result.length > 0) {
                const isUser = check_result[0]['user_role'] === 'user'
                let payload = {
                    'news_title': title,
                    'news_content': JSON.stringify(content),
                    'news_importance': importance,
                    'user_id': id,
                }
                if (isUser && importance) {
                    console.log("User cannot register notice")
                    payload.news_importance = 0;
                }
                const registerNewsContentQuery = query.insertQuery('news', payload);
                connection.query(registerNewsContentQuery, function (error, results, fields) {
                    if (error) {
                        console.log('Register failure during input news data into db');
                        next(ApiError.badRequest('There is a problem with the server. Please try again in a few minutes.'));
                        return;
                    }
                    console.log(results)
                    if (results.affectedRows > 0 || results.changedRows > 0) {
                        if (files.length > 0) {
                            const getNewsIdQuery = query.selectQuery('news', ['idx'], payload)
                            connection.query(getNewsIdQuery, function (error, news_id_results, fields) {
                                if (error) {
                                    console.log('Register failure during get news index into db');
                                    next(ApiError.badRequest('There is a problem with the server. Please try again in a few minutes.'));
                                    return;
                                }
                                const last_insert_news_id = news_id_results[0]['idx'];
                                let registerAttachQuery = 'INSERT INTO news_files (news_files_link, news_files_name, news_id) VALUES ';
                                for (let i = 0; i < files.length; i++) {
                                    registerAttachQuery += `( "${files[i].filename}", "${files[i].originalname}", "${last_insert_news_id}" )`
                                    if (i < files.length - 1) {
                                        registerAttachQuery += ', '
                                    }
                                }
                                console.log(registerAttachQuery)
                                connection.query(registerAttachQuery, function (error, results, fields) {
                                    if (error) {
                                        console.log('Register failure during input news file data into db');
                                        next(ApiError.badRequest('There is a problem with the server. Please try again in a few minutes.'));
                                        return;
                                    }
                                    if (results.affectedRows > 0 || results.changedRows > 0) {
                                        res.status(200).json({
                                            'status': 200,
                                            'msg': 'Register news content success'
                                        });
                                    }
                                    else {
                                        console.log('Register news files failed')
                                        next(ApiError.badRequest('There is a problem with the server. Please try again in a few minutes.'));
                                    }
                                })
                            })
                        }
                        else {
                            res.status(200).json({
                                'status': 200,
                                'msg': 'Register news content success'
                            });
                        }
                    }
                    else {
                        console.log('Register news content failed')
                        next(ApiError.badRequest('There is a problem with the server. Please try again in a few minutes.'));
                    }
                })
            }
            else {
                next(ApiError.badRequest('This is an unsigned email. Please log in again.'));
            }
        })
    } else {
        next(ApiError.badRequest('Please fill in all the values'));
    }

}

exports.readAll = (req, res, next) => {
    const selectAllQuery = 'SELECT * FROM news'
    connection.query(selectAllQuery, async function (error, results, fields) {
        if (error) {
            console.log('Error occurred during reading all news data')
            next(ApiError.badRequest('There is a problem with the server. Please try again in a few minutes.'));
            return;
        }
        if (results.length > 0) {
            let totalResults = await mergeNewsContents(results);
            if (!totalResults) {
                console.log('An error occurred in the process of merging news contents')
                next(ApiError.badRequest('There is a problem with the server. Please try again in a few minutes.'));
            }
            else {
                res.status(200).json({
                    msg: 'Read all news data success',
                    status: 200,
                    data: totalResults
                })
            }
        } else {
            console.log('No news data')
            res.status(200).json({
                msg: 'There is no data',
                status: 200,
                data: []
            })
        }
    })
}

exports.read = (req, res, next) => {
    const {idx} = req.params;
    const selectAllQuery = `SELECT * FROM news where idx = ${idx}`
    connection.query(selectAllQuery, async function (error, results, fields) {
        if (error) {
            console.log('Error occurred during reading news data')
            next(ApiError.badRequest('There is a problem with the server. Please try again in a few minutes.'));
            return;
        }
        if (results.length > 0) {
            let result = {
                idx: results[0].idx,
                title: results[0].news_title,
                content: results[0].news_content,
                created_at: results[0].news_created_at.toISOString().split("T")[0],
                view_count: results[0].news_view_count,
                importance: results[0].news_importance,
                author: results[0].user_id,
                comments: [],
                attach: []
            };
            try {
                let asyncResults = await Promise.all([getUserName(result.author), getNewsFiles(result.idx)]);
                result.author = asyncResults[0];
                result.attach = asyncResults[1];
            } catch (e) {
                next(ApiError.badRequest(e));
            }
            res.status(200).json({
                msg: 'Read news data success',
                status: 200,
                data: result
            })
        }
        else {
            console.log('No news data')
            res.status(200).json({
                msg: 'There is no data',
                status: 200,
                data: {}
            })
        }
    })
}

exports.addViewCount = (req, res, next) => {
    const {idx} = req.params;
    const updateQuery = `UPDATE news SET news_view_count = news_view_count + 1 WHERE idx = ${idx}`
    console.log(updateQuery)

    connection.query(updateQuery, function (error, results, fields) {
        if (error) {
            console.log('Error occurred during updating news view count')
            next(ApiError.badRequest('There is a problem with the server. Please try again in a few minutes.'));
            return;
        }
        if (results.affectedRows > 0 && results.changedRows > 0) {
            res.status(200).json({
                msg: 'Updating news view count success',
                status: 200,
            })
        } else {
            next(ApiError.badRequest('There is no news content corresponding to the index in request body. Please check again.'));
        }
    })
}

exports.getTotalPage = async (req, res, next) => {
    let {itemPerPage, searchBy, keyword} = req.body;
    if (!itemPerPage) {
        itemPerPage = 10;
    }
    let totalPage = 0;
    let totalDataLength = 0;
    if (keyword) {
        await setSearchConditions(searchBy, keyword).then(
            (conditionQuery) => {
                if (conditionQuery.length === 0) {
                    res.status(200).json({
                        msg: `No news results found`,
                        status: 200,
                        data: {
                            totalPage: 1,
                            totalDataLength: 0
                        }
                    })
                } else {
                    let query = `SELECT COUNT(*) as count FROM news WHERE ${conditionQuery}`
                    connection.query(query, function (error, results, fields) {
                        if (error) {
                            console.log('Error occurred during getting news total count')
                            next(ApiError.badRequest('There is a problem with the server. Please try again in a few minutes.'));
                            return;
                        }
                        if (results.length > 0) {
                            totalDataLength = results[0].count
                            totalPage = Math.ceil(results[0].count / itemPerPage)
                            res.status(200).json({
                                msg: 'Get total page count success',
                                status: 200,
                                data: {
                                    totalPage: totalPage,
                                    totalDataLength: totalDataLength
                                }
                            })
                        }
                        else {
                            next(ApiError.badRequest('There is a problem with the server. Please try again in a few minutes.'));
                        }
                    })
                }
            },
            (err) => {
                next(ApiError.badRequest('There is a problem with the server. Please try again in a few minutes.'));
            })
    }
    else {
        const query = 'SELECT COUNT(*) as count FROM news'
        connection.query(query, function (error, results, fields) {
            if (error) {
                console.log('Error occurred during getting news total count')
                next(ApiError.badRequest('There is a problem with the server. Please try again in a few minutes.'));
                return;
            }
            if (results.length > 0) {
                totalDataLength = results[0].count
                totalPage = Math.ceil(results[0].count / itemPerPage)
                res.status(200).json({
                    msg: 'Get total page count success',
                    status: 200,
                    data: {
                        totalPage: totalPage,
                        totalDataLength: totalDataLength
                    }
                })
            }
            else {
                next(ApiError.badRequest('There is a problem with the server. Please try again in a few minutes.'));
            }
        })
    }
}

exports.getNewsContentInPage = async (req, res, next) => {
    let {currentPage, itemPerPage, orderBy, searchBy, keyword} = req.body;

    // Set default value
    if (!itemPerPage) {
        itemPerPage = 10;
    }
    if (!orderBy) {
        orderBy = 'idx'
    }
    if (!searchBy) {
        searchBy = 'total'
    }
    if (!currentPage) {
        currentPage = 1;
    }

    // Convert params to db column name
    let sortBy = 'idx'
    switch (orderBy) {
        case 'no':
            sortBy = 'idx';
            break;
        case 'created_at':
            sortBy = 'news_created_at';
            break;
        case 'view_count':
            sortBy = 'news_view_count';
            break;
        default:
            sortBy = 'idx';
            break
    }

    let searchColumns = 'idx'
    switch (searchBy) {
        case 'total':
            searchColumns = 'news_title, news_content, user_id';
            break;
        case 'title':
            searchColumns = 'news_title';
            break;
        case 'content':
            searchColumns = 'news_content';
            break;
        default:
            searchColumns = 'idx';
            break
    }

    if (!keyword) {
        const query = `SELECT * FROM news ORDER BY FIELD(news_importance, 1) DESC, ${sortBy} DESC LIMIT ${(currentPage-1) * itemPerPage}, ${itemPerPage}`;
        connection.query(query, async function (error, results, fields) {
            if (error) {
                console.log('Error occurred during getting news content in page ' + currentPage)
                next(ApiError.badRequest('There is a problem with the server. Please try again in a few minutes.'));
                return;
            }
            if (results.length > 0) {
                let totalResults = await mergeNewsContents(results, currentPage, itemPerPage);
                if (!totalResults) {
                    console.log('An error occurred in the process of merging news contents')
                    next(ApiError.badRequest('There is a problem with the server. Please try again in a few minutes.'));
                }
                else {
                    res.status(200).json({
                        msg: `Read news content in page ${currentPage} success`,
                        status: 200,
                        data: totalResults
                    })
                }
            }
            else {
                next(ApiError.badRequest(`Content does not exist on "page ${currentPage}". Please search again.`));
            }
        })
    }
    else {
        await setSearchConditions(searchBy, keyword).then(
            (conditionQuery) => {
                if (conditionQuery.length === 0) {
                    res.status(200).json({
                        msg: `No news results found`,
                        status: 200,
                        data: []
                    })
                }
                else {
                    let query = `SELECT * FROM news WHERE ${conditionQuery} ORDER BY FIELD(news_importance, 1) DESC, ${sortBy} DESC LIMIT ${(currentPage-1) * itemPerPage}, ${currentPage * itemPerPage}`
                    connection.query(query, async function (error, results, fields) {
                        if (error) {
                            console.log('Error occurred during searching news contents')
                            next(ApiError.badRequest('There is a problem with the server. Please try again in a few minutes.'));
                            return;
                        }
                        if (results.length > 0) {
                            let totalResults = await mergeNewsContents(results, currentPage, itemPerPage);
                            if (!totalResults) {
                                console.log('An error occurred in the process of merging news contents')
                                next(ApiError.badRequest('There is a problem with the server. Please try again in a few minutes.'));
                            }
                            else {
                                res.status(200).json({
                                    msg: `Read news content in page ${currentPage} success`,
                                    status: 200,
                                    data: totalResults
                                })
                            }
                        } else {
                            console.log(`No news results found`)
                            res.status(200).json({
                                msg: `Read news content in page ${currentPage} success`,
                                status: 200,
                                data: []
                            })
                        }
                    })
                }
            },
            (err) => {
                console.log('Error occurred during searching user name before searching news contents')
                next(ApiError.badRequest('There is a problem with the server. Please try again in a few minutes.'));
            }
        );
    }
}

exports.update = (req, res, next) => {
    const {user_id, news_id} = req.body;
    checkAuthor(user_id, news_id).then(
        (isSame) => {
            if (isSame) {
                res.status(200).json({
                    data: isSame
                })
            }
            else {
                next(ApiError.badRequest('Only the author or admin can edit it.'));
            }
        },
        (err) => {
            next(ApiError.badRequest(err));
        }
    )
}

exports.delete = (req, res, next) => {


}

async function mergeNewsContents(results, page = 1, itemsPerPage = 10) {
    let totalResults = [];
    for (let i = 0; i < results.length; i++) {
        let row = {
            no: i+1+((page-1) * itemsPerPage),
            idx: results[i].idx,
            title: results[i].news_title,
            content: results[i].news_content,
            created_at: results[i].news_created_at.toISOString().split("T")[0],
            view_count: results[i].news_view_count,
            importance: results[i].news_importance,
            author: results[i].user_id,
            comments: [],
            attach: []
        };
        try {
            let asyncResults = await Promise.all([getUserName(row.author), getNewsFiles(row.idx)]);
            row.author = asyncResults[0];
            row.attach = asyncResults[1];
            totalResults.push(row)
        } catch (e) {
            return null;
        }
    }
    return totalResults;
}

function checkAuthor(user_id, news_id) {
    return new Promise((resolve, reject) => {
        const checkQuery = `select (select user_id from news where idx = "${news_id}") = ("${user_id}") as is_same`
        connection.query(checkQuery, async function (error, results, fields) {
            if (error) {
                reject('There is a problem with the server. Please try again in a few minutes.')
            }
            else if (results[0]['is_same'] === 1) {
                resolve(true)
            } else {
                resolve(false)
            }
        })
    })
}

function getUserName(user_id) {
    return new Promise(((resolve, reject) => {
        const selectQuery = query.selectQuery('user', ['user_name'], {'user_id': user_id})
        connection.query(selectQuery, async function (error, results, fields) {
            if (error) {
                reject('There is a problem with the server. Please try again in a few minutes.')
            }
            else if (results.length > 0) {
                resolve(results[0].user_name)
            } else {
                reject('This is not a registered email. Please log in again.')
            }
        });
    }))
}


function getNewsFiles(news_id) {
    return new Promise(((resolve, reject) => {
        const selectQuery = query.selectQuery('news_files', ['news_files_name', 'news_files_link'], {news_id: news_id});
        connection.query(selectQuery, async function (error, results, fields) {
            if (error) {
                reject('There is a problem with the server. Please try again in a few minutes.')
            }
            else if (results.length > 0) {
                resolve(results.map(x => {
                    return {
                        link: `${address.ip}:${address.port}/${address.path}/${x.news_files_link}`,
                        name: x.news_files_name
                    }
                }))
            } else {
                resolve([])
            }
        });
    }))
}

async function setSearchConditions(searchBy, keyword) {
    return new Promise(((resolve, reject) => {
        if (searchBy === 'author' || searchBy === 'total') {
            const selectUserQuery = `SELECT user_id, user_name FROM user WHERE user_name REGEXP "${keyword}"`;
            connection.query(selectUserQuery, async function (err, userInfos, fields) {
                if (err) {
                    console.log('Error occurred during searching user name before searching news contents')
                    reject();
                }
                else {
                    let conditionQuery = ``

                    if (userInfos.length > 0) {
                        for (let i = 0; i < userInfos.length; i++) {
                            conditionQuery += `user_id = "${userInfos[i].user_id}"`
                            if (i < userInfos.length - 1) {
                                conditionQuery += ' or '
                            }
                        }
                        if (searchBy === 'total') {
                            conditionQuery += ` or news_title REGEXP "${keyword}" or news_content REGEXP "${keyword}" or user_id REGEXP "${keyword}"`
                        }
                    }
                    else if (searchBy === 'total') {
                        conditionQuery += `news_title REGEXP "${keyword}" or news_content REGEXP "${keyword}" or user_id REGEXP "${keyword}"`
                    }
                    else {
                        console.log(`No news results found`)
                        resolve('')
                    }
                    resolve(conditionQuery)
                }
            })
        }
        else if (searchBy === 'title'){
            resolve(`news_title REGEXP "${keyword}"`)
        }
        else if (searchBy === 'content') {
            resolve(`news_content REGEXP "${keyword}"`)
        }
    }))
}
