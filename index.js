const assert = require('assert')
const http = require('http')

const fetch = require('node-fetch')
const debug = require('debug')
const webhooks = require('@octokit/webhooks')({
  secret: process.env.GITHUB_TOKEN
})
const rest = require('@octokit/rest')()
rest.authenticate({
  type: 'token',
  token: process.env.GITHUB_TOKEN
})
const { Chess } = require('chess.js')

const parseBoard = board => {
  const lines = board.replace(/^\s+|\s+$/g, '').split('\n')
  assert(lines.length === 10, 'Lines must be 10')

  lines.shift()
  lines.shift()

  const chess = new Chess()
  chess.clear()
  lines.forEach((line, index) => {
    const lineIndex = 8 - index
    const squares = line.split('|')
    assert(squares.length === 10, `Line ${lineIndex} must have 9 lines`)

    squares.shift()
    squares.pop()

    squares.forEach((square, index) => {
      if (square === '　') return
      const squareIndex = String.fromCharCode('a'.charCodeAt(0) + index) + lineIndex
      const piece = {
        '♜': { type: chess.ROOK, color: chess.BLACK },
        '♞': { type: chess.KNIGHT, color: chess.BLACK },
        '♝': { type: chess.BISHOP, color: chess.BLACK },
        '♚': { type: chess.KING, color: chess.BLACK },
        '♛': { type: chess.QUEEN, color: chess.BLACK },
        '♟': { type: chess.PAWN, color: chess.BLACK },
        '♖': { type: chess.ROOK, color: chess.WHITE },
        '♘': { type: chess.KNIGHT, color: chess.WHITE },
        '♗': { type: chess.BISHOP, color: chess.WHITE },
        '♔': { type: chess.KING, color: chess.WHITE },
        '♕': { type: chess.QUEEN, color: chess.WHITE },
        '♙': { type: chess.PAWN, color: chess.WHITE }
      }[square]

      assert(piece !== undefined, `Unknown piece in ${squareIndex}: ${square}`)
      assert(chess.put(piece, squareIndex), `Put ${JSON.stringify(piece)} into ${squareIndex} failed.`)
    })
  })

  console.log(chess.ascii())

  return chess.ascii()
}

webhooks.on(['pull_request.opened', 'pull_request.reopened'], async ({ payload }) => {
  const log = debug(`chessbot:#${payload.number}`)
  const { 'pull_request': pullRequest } = payload

  if (pullRequest.base.ref !== pullRequest.base.repo.default_branch) {
    return log('Ignored', 'base is not default branch')
  }

  const repoMeta = {
    owner: pullRequest.base.repo.owner.login,
    repo: pullRequest.base.repo.name
  }
  const pullRequestMeta = {
    ...repoMeta,
    number: pullRequest.number
  }

  try {
    const { data: files } = await rest.pullRequests.getFiles({
      ...pullRequestMeta,
      per_page: 2
    })
    log(files)
    assert(files.length === 1, 'Only `README.md` should be changed.')

    const file = files[0]
    assert(file.filename === 'README.md' && file.status === 'modified',
      'Only `README.md` should be changed.')

    const board = await fetch(file.raw_url).then(response => {
      assert(response.ok, 'Request content failed.')
      return response.text()
    })
    log('Target Board', board)
    const asciiBoard = parseBoard(board)

    const { data: commits } = await rest.repos.getCommits({
      ...repoMeta,
      per_page: 1
    })
    assert(commits.length > 0, 'There must be an initial commit.')

    const commit = commits[0]
    const message = commit.commit.message
    log('Current history', message)

    const chess = new Chess()
    if (message !== 'Initial commit') {
      const moves = message.split('\n').slice(2)
      for (const move of moves) {
        chess.move(move)
      }
    }

    let currentMove = null
    for (const move of chess.moves()) {
      chess.move(move)
      console.log(chess.ascii(), asciiBoard)
      if (chess.ascii() === asciiBoard) {
        currentMove = move
        break
      }
      chess.undo()
    }

    assert(currentMove !== null, 'Invalid move')

    log('Validated move, merged', currentMove)

    await rest.pullRequests.merge({
      ...pullRequestMeta,
      commit_title: 'Moved by Chessbot',
      commit_message: chess.history().join('\n'),
      sha: commit.sha,
      merge_method: 'squash'
    })
  } catch (e) {
    if (!(e instanceof assert.AssertionError)) throw e

    await rest.pullRequests.update({
      ...pullRequestMeta,
      body: e.message,
      state: 'closed'
    })
    return log('Closed', e.message)
  }
})

const server = module.exports = http.createServer(webhooks.middleware)

if (require.main === module) {
  server.listen(process.env.PORT)
}
