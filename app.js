const puppeteer = require('puppeteer');
const fetch = require('isomorphic-fetch')
const chalk = require('chalk')
const log = console.log;

const baseUrl = 'https://www.bjjnts.cn'

const username = '500108199101096116'
const password = 'y13271814371'

const login = async (page, username, password) => {
  await page.goto(`${baseUrl}/login`);

  await page.type('input[name=username]', username)
  await page.type('input[name=password]', password)
  await page.click('button[type=submit]')
  await page.waitForNavigation()

}

// 获取课程列表
const getCourseList = async (page) => {
  const $courseList = await page.$$('.user_courselist li')


  return Promise.all($courseList.map(async item => {

    const { courseId, lessionId } = await item.$eval('.user_coursepic a', node => ({
      courseId: node.getAttribute('data-id'),
      lessionId: node.getAttribute('data-cid')
    }))

    const courseName = await item.$eval('.user_coursetit', node => node.innerText)

    const chapter = await item.$eval('.course_chapter', node => node.innerText)

    const totalTime = await item.$eval('.course_chapter + p', node => node.innerText)

    const completePercent = await item.$eval('.study_complete_percent', node => node.innerText)

    return {
      courseName,
      courseId,
      lessionId,
      completePercent,
      chapter,
      totalTime,
      url: `${baseUrl}/lessonStudy/${courseId}/${lessionId}`
    }
  }))
}


// 获取课时列表
const getLessionList = async (page, course) => {
  const { courseName, courseId, url } = course

  await page.goto(url)

  const $lessionLinks = await page.$$('.new_demoul li')

  return Promise.all($lessionLinks.map(async item => {

    const { lessionId, lessionNum } = await item.$eval('a', node => ({
      lessionId: node.getAttribute('data-lessonid'),
      lessionNum: node.getAttribute('data-lessonnum')
    }))

    const lessionName = await item.$eval('.course_study_menutitle', node => node.innerText)
    const lessionTotalTime = await item.$eval('.course_study_menudate', node => node.innerText)
    const completePercentText = await item.$eval('.course_study_menuschedule em', node => node.innerText)
    const completePercent = (completePercentText.split('\n')[1] || '0%').trim()

    return {
      courseName,
      lessionName,
      courseId,
      lessionId,
      lessionNum,
      lessionTotalTime,
      completePercent
    }
  }))
}

// 执行学习
const learnLesson = async ({ lessionName, courseId, lessionId }, cookie) => {

  log(chalk.gray(`开始学习课时：${lessionName}`))

  const url = `${baseUrl}/lessonStudy/${courseId}/${lessionId}`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 11_0_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.198 Safari/537.36',
      'content-type': 'application/json',
      'cookie': cookie
    },
    referer: url
  })

  const { data: { duration, learnDuration } } = await response.json()

  const postUrl = `${baseUrl}/addstudentTaskVer2/${courseId}/${lessionId}`


  const postResponse = await fetch(postUrl, {
    body: JSON.stringify({ "learnTime": duration, "push_event": "ended" }),
    method: 'POST',
    headers: {
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 11_0_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.198 Safari/537.36',
      'content-type': 'application/json',
      'cookie': cookie
    },
    referer: url
  })
  const { msg, code } = await postResponse.json()

  log(chalk.gray(`结束学习课时${lessionName}（服务器返回-${code}-${msg}）\n`))

  if (code === 0 || msg === '您今天学习时长已经超过8小时，停止课时统计') {
    process.exit(0)
  }
}

// 获取cookie
const getCookiesString = async (page) => {
  const cookies = await page.cookies()
  return cookies.reduce((cookiesString, { name, value }) => `${cookiesString}${name}=${value};`, '')
}

(async () => {
  const browser = await puppeteer.launch({
    defaultViewport: {
      width: 1344,
      height: 768
    }
  });
  const page = await browser.newPage();


  await login(page, username, password)

  log(chalk.green('登录成功！\n'))


  const cookies = await getCookiesString(page)


  log(chalk.green(`获取cookie成功!\n`))


  log(chalk.gray('开始收集课程列表...\n'))

  const courseList = await getCourseList(page)

  log(chalk.green.bold(`----- 你的课程列表 ------`))

  const courseListDesc = courseList.map(({ courseName, completePercent,
    chapter,
    totalTime }, index) => `${index + 1}. ${courseName}(${chapter},${totalTime}) -- 进度${completePercent}`).join('\n')

  log(chalk.cyan(courseListDesc))

  log(chalk.gray('开始刷课...\n'))


  const unFinishCourseList = courseList.filter(item => item.completePercent !== '100%')


  await unFinishCourseList.reduce((chain, course) => chain.then(async () => {
    const { courseName } = course
    log(chalk.gray(`---- 开始学习课程：${courseName} ----\n`))

    const lessionList = await getLessionList(page, course)

    const unFinishLessionList = lessionList.filter(item => item.completePercent !== '100%')
    const lessionDesc = unFinishLessionList.map(({ lessionName, lessionTotalTime,
      completePercent, }, index) => `${index}. ${lessionName}(${lessionTotalTime}) -- 进度${completePercent}`).join('\n')

    log(chalk.gray('当前课程未完成课时列表:'))
    log(chalk.cyan(`${lessionDesc}\n`))

    for (let index = 0; index < unFinishLessionList.length; index++) {
      await learnLesson(unFinishLessionList[index], cookies)
    }

    log(chalk.gray(`---- 结束学习课程：${courseName} ----\n`))


  }), Promise.resolve())

  await browser.close();
})();