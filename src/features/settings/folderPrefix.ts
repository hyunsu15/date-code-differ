import * as userConfig from '../../../change/config.ts'
import { ALL_PREFIXES_ID, type FolderPrefix } from '../../types.ts'

/**
 * 날짜 폴더 이름 접두사 필터.
 *
 * 한 폴더에 환경별 스냅샷이 섞여 있을 때(`prod_20260801` · `test_20260801`) 어느 쪽을 볼지 고른다.
 * 목록은 `change/config.ts` 의 `FOLDER_PREFIXES` 에서 오고 — 파일이 진실이라 고치면 바로 반영된다 —
 * 고른 값은 이 브라우저의 localStorage 에만 남는다.
 *
 * 거르는 일 자체는 서버가 한다. 스냅샷마다 파일을 훑는 게 비싼 작업이라
 * (SSH 면 폴더당 `find` 한 번) 훑기 전에 걸러야 의미가 있기 때문이다.
 * 서버는 상태를 두지 않으므로 고른 접두사는 요청마다 쿼리로 함께 보낸다.
 */

const STORAGE_KEY = 'cd-prefix'

/**
 * 접두사 설정은 나중에 생겼다 — 예전에 만들어 둔 `change/config.ts` 에는 없을 수 있다.
 * 없으면 접두사 고르기를 통째로 숨긴다 (설정 하나 때문에 화면이 죽는 것보다 낫다).
 */
const configured = userConfig as {
  FOLDER_PREFIXES?: FolderPrefix[]
  DEFAULT_PREFIX_ID?: string
}

/** 설정에 적힌 접두사들. 값이 비었거나 예약 id(`all`) 를 쓴 항목은 버린다 */
export const FOLDER_PREFIXES: FolderPrefix[] = (
  Array.isArray(configured.FOLDER_PREFIXES) ? configured.FOLDER_PREFIXES : []
).filter((p) => p?.id && p.id !== ALL_PREFIXES_ID && p.prefix?.trim())

/** 거르지 않는 항목 — 목록의 맨 앞에 둔다 */
export const ALL_PREFIX: FolderPrefix = {
  id: ALL_PREFIXES_ID,
  label: '전체',
  prefix: '',
  description: '접두사로 거르지 않고 모두 봅니다',
}

/** 화면에 그릴 목록. 설정에 접두사가 없으면 빈 배열 = 고르는 자리를 아예 두지 않는다 */
export const PREFIX_CHOICES: FolderPrefix[] =
  FOLDER_PREFIXES.length > 0 ? [ALL_PREFIX, ...FOLDER_PREFIXES] : []

/** 모르는 id 는 전부 보기로 떨어진다 (설정에서 항목을 지운 경우) */
export const prefixById = (id: string): FolderPrefix =>
  PREFIX_CHOICES.find((p) => p.id === id) ?? ALL_PREFIX

/** 저장된 선택이 없을 때 쓸 접두사 — `change/config.ts` 의 `DEFAULT_PREFIX_ID` 를 따른다 */
export function defaultPrefixId(): string {
  const id = configured.DEFAULT_PREFIX_ID
  return typeof id === 'string' ? prefixById(id).id : ALL_PREFIXES_ID
}

/** 저장값을 선택 상태로 바꾼다 */
export function parsePrefixId(raw: string | null): string {
  return raw ? prefixById(raw).id : defaultPrefixId()
}

export function loadPrefixId(): string {
  try {
    return parsePrefixId(localStorage.getItem(STORAGE_KEY))
  } catch {
    return defaultPrefixId() // 저장소 접근 자체가 막힌 브라우저
  }
}

export function savePrefixId(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // 저장 실패해도 이번 세션 동작에는 지장이 없다
  }
}

/** 실제로 거를 문자열. 전체 보기면 빈 문자열 */
export const prefixValue = (id: string): string => prefixById(id).prefix.trim()
