const fs   = require('fs')
const os   = require('os')
const path = require('path')

const SUMMARY_STATE_FILE = path.join(os.tmpdir(), 'botium-care-summary.json')

module.exports = async (view) => {
  const root = view.botMsgRoot
  if (!root || !Array.isArray(root.suggestActions) || root.suggestActions.length === 0) return

  const action = root.suggestActions[0]
  if (!action || !action.extractedData || !action.extractedData.summary) return

  const summary = action.extractedData.summary
  const sessionId = view.context && view.context.sessionId

  console.log('[care-response-hook] Captured summary for session:', sessionId)

  const state = {
    sessionId,
    capturedAt: new Date().toISOString(),
    summary
  }

  fs.writeFileSync(SUMMARY_STATE_FILE, JSON.stringify(state, null, 2))
}

module.exports.SUMMARY_STATE_FILE = SUMMARY_STATE_FILE
