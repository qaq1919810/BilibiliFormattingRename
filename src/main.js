const fs = require('fs')
const path = require('path')
const axios = require('axios')
const readline = require('readline')

// ---------------------------
// 配置部分
// ---------------------------
const DOWNLOAD_DIR = ''
// 处理个数 all为全部处理
const REQUEST_COUNT = 'all'

// 命名格式（支持替换 index、title、yyyy、MM、dd、hh、mm、ss）
// 注意：括号 () 内的时间格式会被替换
const NAME_FORMAT = "index-title-(yyyy-MM-dd-hh-mm-ss)"

// ---------------------------
// 获取文件夹列表（根目录下的avid文件夹）
// ---------------------------
let folders = fs.readdirSync(DOWNLOAD_DIR, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name)

if (REQUEST_COUNT !== 'all') {
    const count = parseInt(REQUEST_COUNT, 10)
    if (!isNaN(count) && count > 0) {
        folders = folders.slice(0, count)
    }
}

// ---------------------------
// B站请求头
// ---------------------------
const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    'Referer': 'https://www.bilibili.com/'
}

// B站可能返回的错误码
const ERROR_CODES = [-400, -403, -404, 62002, 62004, 62012]

// ---------------------------
// 获取单个视频信息函数
// ---------------------------
async function fetchVideoInfo(avid, retries = 3) {
    const url = `https://api.bilibili.com/x/web-interface/view?aid=${avid}`
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const resp = await axios.get(url, { headers })
            const data = resp.data

            if (data.code === 0) {
                return { avid: data.data.aid, title: data.data.title, pubdate: data.data.pubdate }
            } else {
                if (ERROR_CODES.includes(data.code)) {
                    console.log(`AVID ${avid} 第${attempt}次返回B站错误码: ${data.code}`)
                    if (attempt === retries) return { avid, code: data.code }
                } else {
                    console.log(`AVID ${avid} 第${attempt}次返回未知错误码: ${data.code}, message: ${data.message}`)
                }
            }
        } catch (err) {
            console.log(`AVID ${avid} 第${attempt}次网络错误: ${err.message}`)
        }
    }
    return null
}

// ---------------------------
// 批量获取视频信息并显示进度
// ---------------------------
async function fetchInBatchesWithProgress(avids, batchSize = 5) {
    const errors = []
    const results = []
    let processed = 0
    const total = avids.length

    for (let i = 0; i < avids.length; i += batchSize) {
        const batch = avids.slice(i, i + batchSize)
        const promises = batch.map(avid => fetchVideoInfo(avid))
        const batchResults = await Promise.all(promises)

        batchResults.forEach(res => {
            processed++
            console.log(`进度: ${processed}/${total}`)
            if (res) {
                if (res.code) {
                    errors.push(res)
                } else {
                    results.push(res)
                    console.log(`AVID: ${res.avid}, 标题: ${res.title}, 发布时间: ${res.pubdate}`)
                }
            }
        })

        console.log(`批次 ${Math.floor(i / batchSize) + 1} 完成，共 ${batch.length} 条`)
    }

    return { errors, results }
}

// ---------------------------
// 时间戳转格式（根据 NAME_FORMAT 中的模板）
// ---------------------------
function formatTime(timestamp, formatTemplate) {
    const d = new Date(timestamp * 1000)
    const pad = n => n.toString().padStart(2, '0')

    return formatTemplate
        .replace("yyyy", d.getFullYear())
        .replace("MM", pad(d.getMonth() + 1))
        .replace("dd", pad(d.getDate()))
        .replace("hh", pad(d.getHours()))
        .replace("mm", pad(d.getMinutes()))
        .replace("ss", pad(d.getSeconds()))
}

// ---------------------------
// 文件名合法化
// ---------------------------
function safeFileName(name) {
    let safe = name.replace(/[\/\\:*?"<>|]/g, '_')
    const reserved = ['CON','PRN','AUX','NUL',
        'COM1','COM2','COM3','COM4','COM5','COM6','COM7','COM8','COM9',
        'LPT1','LPT2','LPT3','LPT4','LPT5','LPT6','LPT7','LPT8','LPT9']
    if (reserved.includes(safe.toUpperCase())) {
        safe = '_' + safe
    }
    return safe
}

// ---------------------------
// 命令行输入函数
// ---------------------------
function askQuestion(query) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    })
    return new Promise(resolve => rl.question(query, ans => {
        rl.close()
        resolve(ans.trim())
    }))
}

// ---------------------------
// 主程序
// ---------------------------
;(async () => {
    const { errors, results } = await fetchInBatchesWithProgress(folders, 5)

    if (errors.length > 0) {
        console.log('\n以下 AVID 重试3次仍然返回错误：')
        errors.forEach(e => console.log(`AVID: ${e.avid}, 错误码: ${e.code}`))
        console.log('有视频请求失败，改名操作取消')
        return
    }

    results.sort((a, b) => a.pubdate - b.pubdate)

    // 生成改名列表
    const renameList = results.map((info, index) => {
        const srcName = info.avid.toString()

        // 拿到时间格式部分 ( ... )
        let timePart = NAME_FORMAT.match(/\((.*?)\)/)
        timePart = timePart ? timePart[1] : "yyyy-MM-dd-hh-mm-ss"

        let newName = NAME_FORMAT
            .replace("index", `${index + 1}`)
            .replace("title", safeFileName(info.title))
            .replace(/\(.*?\)/, formatTime(info.pubdate, timePart))

        return { srcName, newName }
    })

    console.log('\n改名预览:')
    renameList.forEach(item => console.log(`${item.srcName} -> ${item.newName}`))

    while (true) {
        const answer = await askQuestion('确认改名吗？输入 y 或 1 执行，其他字符不执行，n 或 0 退出: ')
        if (answer.toLowerCase() === 'y' || answer === '1') {
            renameList.forEach(item => {
                const oldPath = path.join(DOWNLOAD_DIR, item.srcName)
                const newPath = path.join(DOWNLOAD_DIR, item.newName)
                try {
                    fs.renameSync(oldPath, newPath)
                    console.log(`已改名: ${item.srcName} -> ${item.newName}`)
                } catch (err) {
                    console.log(`改名失败: ${item.srcName} -> ${item.newName}, 错误: ${err.message}`)
                }
            })
            break
        } else if (answer.toLowerCase() === 'n' || answer === '0') {
            console.log('操作已取消')
            break
        } else {
            console.log('未执行，重新输入')
        }
    }
})()
