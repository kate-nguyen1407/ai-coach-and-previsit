require('dotenv').config()

const path = require('path')
const BotDriver = require('../../').BotDriver

const convosDir = path.resolve(__dirname, 'aiCoach', 'en')

const ELFIE_HOST = (process.env.ELFIE_ENV || '').toLowerCase() === 'prod'
  ? 'api.elfie.co' : 'api.stg.elfie.co'

const convoFiles = [
  '01_greeting.convo.txt',
  '02_blood_sugar.convo.txt',
  '03_blood_pressure.convo.txt',
  '04_hydration.convo.txt',
  '05_weight.convo.txt',
  '06_exercise.convo.txt',
  '07_medication.convo.txt',
  '08_symptom.convo.txt',
  '09_cholesterol.convo.txt',
  '10_general_advice.convo.txt'
]

describe('AI Coach', function () {
  this.timeout(60000)

  convoFiles.forEach((file) => {
    it(file.replace('.convo.txt', ''), async function () {
      const driver = new BotDriver({
        SIMPLEREST_URL: `https://${ELFIE_HOST}/agent/api/v1/ai-coach/chat`,
        SIMPLEREST_START_HOOK: path.resolve(__dirname, '../../botium-hook-ai-coach.js'),
        SIMPLEREST_HEADERS_TEMPLATE: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ELFIE_API_KEY || ''
        }
      })
      const compiler = driver.BuildCompiler()
      const container = await driver.Build()
      await container.Start()

      try {
        compiler.ReadScript(convosDir, file)
        const convo = compiler.convos[compiler.convos.length - 1]
        await convo.Run(container)
      } finally {
        await container.Stop()
        await container.Clean()
      }
    })
  })
})
