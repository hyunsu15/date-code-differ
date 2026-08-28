import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  connectionKey,
  forgetAllPasswords,
  forgetPassword,
  getPassword,
  hasPassword,
  normalizeConnectionTarget,
  pendingConnection,
  registeredConnections,
  setPassword,
  setPendingConnection,
} from '../server/source/passwordStore.ts'

/**
 * 비밀번호는 개발 서버 프로세스 메모리에만 있다.
 * 파일·localStorage·URL 어디에도 쓰지 않는다.
 */

beforeEach(() => forgetAllPasswords())

test('접속 키는 user@host:port — 포트를 비우면 22 로 본다', () => {
  assert.equal(connectionKey({ user: 'deploy', host: 'build-01', port: null }), 'deploy@build-01:22')
  assert.equal(connectionKey({ user: 'deploy', host: 'build-01', port: 2222 }), 'deploy@build-01:2222')
})

test('같은 서버·계정이면 같은 비밀번호를 쓴다', () => {
  const a = connectionKey({ user: 'u', host: 'h', port: null })
  const b = connectionKey({ user: 'u', host: 'h', port: 22 })
  assert.equal(a, b)
})

test('서버나 계정이 다르면 따로 보관한다', () => {
  setPassword(connectionKey({ user: 'a', host: 'h', port: null }), 'pw-a')
  setPassword(connectionKey({ user: 'b', host: 'h', port: null }), 'pw-b')

  assert.equal(getPassword('a@h:22'), 'pw-a')
  assert.equal(getPassword('b@h:22'), 'pw-b')
})

test('넣고 빼고 지운다', () => {
  const key = 'u@h:22'
  assert.equal(hasPassword(key), false)
  assert.equal(getPassword(key), undefined)

  setPassword(key, 'secret')
  assert.equal(hasPassword(key), true)
  assert.equal(getPassword(key), 'secret')

  forgetPassword(key)
  assert.equal(hasPassword(key), false)
})

test('등록 목록은 접속 대상만 알려주고 값은 절대 내보내지 않는다', () => {
  setPassword('u@h:22', 'secret')
  const listed = registeredConnections()

  assert.deepEqual(listed, ['u@h:22'])
  assert.equal(JSON.stringify(listed).includes('secret'), false)
})

test('전부 지우기', () => {
  setPassword('a@h:22', 'x')
  setPassword('b@h:22', 'y')
  forgetAllPasswords()
  assert.deepEqual(registeredConnections(), [])
})

test('특수문자 비밀번호도 그대로 보관한다', () => {
  const tricky = 'p@ss&w|o<r>d^%!"\ 한글'
  setPassword('u@h:22', tricky)
  assert.equal(getPassword('u@h:22'), tricky)
})

/* ---------------- 사람이 적은 대상 맞추기 ---------------- */

test('포트를 생략하면 22 로 채운다 — 보관 키와 같은 형태가 되어야 한다', () => {
  assert.equal(normalizeConnectionTarget('deploy@build-01'), 'deploy@build-01:22')
  assert.equal(normalizeConnectionTarget('deploy@build-01:22'), 'deploy@build-01:22')
  assert.equal(
    normalizeConnectionTarget('deploy@build-01'),
    connectionKey({ user: 'deploy', host: 'build-01', port: null })
  )
})

test('포트를 적으면 그대로 쓴다', () => {
  assert.equal(normalizeConnectionTarget('deploy@build-01:2222'), 'deploy@build-01:2222')
})

test('앞뒤 공백은 떼어낸다', () => {
  assert.equal(normalizeConnectionTarget('  deploy@build-01:22  '), 'deploy@build-01:22')
})

test('형식이 아니면 null', () => {
  const bad = [
    '',
    'build-01',            // 계정이 없다
    '@build-01',           // 계정이 비었다
    'deploy@',             // 호스트가 비었다
    'deploy@host:0',       // 포트 범위 밖
    'deploy@host:70000',
    'deploy@host:abc',     // 포트가 숫자가 아니다
    'deploy@host:22:22',   // 호스트에 콜론
    'dep loy@host:22',     // 공백
    'deploy@ho st:22',
  ]
  for (const value of bad) assert.equal(normalizeConnectionTarget(value), null, value)
})

/* ---------------- 기다리는 대상 ---------------- */

test('처음에는 기다리는 대상이 없다', () => {
  assert.equal(pendingConnection(), null)
})

test('비밀번호가 필요했던 접속을 기억한다 — ssh-login 이 이걸 기본 대상으로 쓴다', () => {
  setPendingConnection('deploy@build-01:2222')
  assert.equal(pendingConnection(), 'deploy@build-01:2222')
})

test('기다리는 대상에는 비밀번호가 들어가지 않는다', () => {
  setPassword('deploy@build-01:2222', 'secret')
  setPendingConnection('deploy@build-01:2222')
  assert.equal(JSON.stringify(pendingConnection()).includes('secret'), false)
})

test('전부 지우면 기다리던 대상도 지운다 ("처음부터 다시" 라는 뜻)', () => {
  setPendingConnection('deploy@build-01:2222')
  forgetAllPasswords()
  assert.equal(pendingConnection(), null)
})
