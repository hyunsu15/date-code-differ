import { useEffect, useState } from 'react'
import {
  DEFAULT_SSH_SOURCE,
  describeSource,
  missingFields,
  presetById,
  SOURCE_PRESETS,
  type SourceSelection,
} from './sourceSettings.ts'
import { TEXT_ENCODINGS } from '../../types.ts'
import type { SourceConfig, SourceMode, SshSourceConfig, TextEncodingName } from '../../types.ts'

interface SettingsPanelProps {
  value: SourceSelection
  onApply: (next: SourceSelection) => void
  onClose: () => void
  /**
   * **내 제외 목록** 원문 (`features/settings/localExclude.ts`).
   *
   * 위치 설정과 달리 **적용을 누르지 않아도 바로** 저장된다 — 이 브라우저에만 남는
   * 값이고, 파일 목록의 접기 버튼도 같은 목록을 그때그때 고치기 때문이다.
   * 두 자리가 다르게 굴면 어느 쪽이 반영된 것인지 알 수 없다.
   */
  myExclude: string
  onChangeMyExclude: (text: string) => void
  /** 스키마 쪽 내 목록 — 대상이 테이블·컬럼이라 소스 쪽과 따로 둔다 */
  mySchemaExclude: string
  onChangeMySchemaExclude: (text: string) => void
}

/**
 * 편집 중인 값.
 * 두 모드의 입력을 각각 들고 있어야 모드를 오갈 때 지운 값이 날아가지 않는다.
 */
interface Draft {
  /** 고른 프리셋 id. 값을 직접 고치면 null 로 풀린다 */
  presetId: string | null
  mode: SourceMode
  localRoot: string
  /** 로컬일 때의 제외 목록 파일. SSH 쪽 값은 `ssh.excludeFile` 이 따로 든다 */
  localExclude: string
  /** 로컬일 때의 스키마 폴더. SSH 쪽 값은 `ssh.schemaRoot` 이 따로 든다 */
  localSchemaRoot: string
  /** 로컬일 때의 스키마 제외 목록 파일. SSH 쪽은 `ssh.schemaExcludeFile` */
  localSchemaExclude: string
  ssh: SshSourceConfig
  /** 인코딩은 두 모드가 함께 쓴다 */
  encoding: TextEncodingName
}

function toDraft(selection: SourceSelection): Draft {
  const { source } = selection
  return {
    presetId: selection.presetId,
    mode: source.mode,
    localRoot: source.mode === 'local' ? source.root : '',
    localExclude: source.mode === 'local' ? (source.excludeFile ?? '') : '',
    localSchemaRoot: source.mode === 'local' ? (source.schemaRoot ?? '') : '',
    localSchemaExclude: source.mode === 'local' ? (source.schemaExcludeFile ?? '') : '',
    ssh: source.mode === 'ssh' ? source : DEFAULT_SSH_SOURCE,
    encoding: source.encoding,
  }
}

function draftSource(draft: Draft): SourceConfig {
  if (draft.mode === 'local') {
    return {
      mode: 'local',
      root: draft.localRoot.trim(),
      encoding: draft.encoding,
      excludeFile: draft.localExclude.trim(),
      schemaRoot: draft.localSchemaRoot.trim(),
      schemaExcludeFile: draft.localSchemaExclude.trim(),
    }
  }
  return {
    ...draft.ssh,
    host: draft.ssh.host.trim(),
    user: draft.ssh.user.trim(),
    identityFile: draft.ssh.identityFile.trim(),
    root: draft.ssh.root.trim(),
    encoding: draft.encoding,
    excludeFile: (draft.ssh.excludeFile ?? '').trim(),
  }
}

/**
 * 비교 대상 위치 설정.
 *
 * 프리셋은 `change/config.ts` 에서 온다. 값을 직접 고치면 "직접 입력"으로 바뀌고
 * 이 브라우저의 localStorage 에만 저장된다.
 */
export default function SettingsPanel({
  value,
  onApply,
  onClose,
  myExclude,
  onChangeMyExclude,
  mySchemaExclude,
  onChangeMySchemaExclude,
}: SettingsPanelProps) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(value))

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  /** 값을 손대면 프리셋에서 풀려 "직접 입력"이 된다 */
  const edit = (patch: Partial<Omit<Draft, 'presetId'>>): void =>
    setDraft((d) => ({ ...d, ...patch, presetId: null }))

  const setSsh = <K extends keyof SshSourceConfig>(key: K, v: SshSourceConfig[K]): void =>
    setDraft((d) => ({ ...d, ssh: { ...d.ssh, [key]: v }, presetId: null }))

  const choosePreset = (id: string): void => {
    const preset = presetById(id)
    if (preset) setDraft({ ...toDraft({ presetId: preset.id, source: preset.source }) })
  }

  const source = draftSource(draft)
  const missing = missingFields(source)
  const canApply = missing.length === 0

  const apply = (): void => {
    if (!canApply) return
    onApply({ presetId: draft.presetId, source })
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="settings"
        role="dialog"
        aria-modal="true"
        aria-label="비교 대상 위치 설정"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header>
          <b>비교 대상 위치</b>
          <button type="button" className="btn sm" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </header>

        <div className="settings-body">
          {/* ---------- 프리셋 ---------- */}
          <div className="preset-list" role="radiogroup" aria-label="위치 프리셋">
            {SOURCE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                role="radio"
                aria-checked={draft.presetId === preset.id}
                className={`preset ${draft.presetId === preset.id ? 'active' : ''}`}
                onClick={() => choosePreset(preset.id)}
              >
                <span className={`preset-kind ${preset.source.mode}`}>
                  {preset.source.mode === 'ssh' ? 'SSH' : '폴더'}
                </span>
                <span className="preset-text">
                  <b>{preset.label}</b>
                  <small>{preset.description ?? describeSource(preset.source)}</small>
                </span>
              </button>
            ))}

            <div className={`preset custom ${draft.presetId === null ? 'active' : ''}`}>
              <span className="preset-kind custom">직접</span>
              <span className="preset-text">
                <b>직접 입력</b>
                <small>아래 값을 고치면 자동으로 여기로 바뀝니다</small>
              </span>
            </div>
          </div>

          <p className="settings-note">
            프리셋은 <code>change/config.ts</code> 에서 관리합니다. 그 파일을 고치면 여기에 바로
            반영됩니다.
          </p>

          <div className="settings-divider" />

          {/* ---------- 모드 ---------- */}
          <div className="btn-group mode">
            <button
              type="button"
              className={`btn sm ${draft.mode === 'local' ? 'active' : ''}`}
              onClick={() => edit({ mode: 'local' })}
            >
              내 PC 폴더
            </button>
            <button
              type="button"
              className={`btn sm ${draft.mode === 'ssh' ? 'active' : ''}`}
              onClick={() => edit({ mode: 'ssh' })}
            >
              SSH 원격
            </button>
          </div>

          {draft.mode === 'local' ? (
            <label className="field">
              <span>폴더 경로</span>
              <input
                type="text"
                value={draft.localRoot}
                onChange={(e) => edit({ localRoot: e.target.value })}
                placeholder="D:/release"
                spellCheck={false}
              />
              <small>날짜 폴더들의 부모 폴더. 상대 경로는 이 프로젝트 폴더 기준입니다.</small>
            </label>
          ) : (
            <>
              <div className="field-row">
                <label className="field grow">
                  <span>호스트</span>
                  <input
                    type="text"
                    value={draft.ssh.host}
                    onChange={(e) => setSsh('host', e.target.value)}
                    placeholder="dev-server 또는 10.0.0.5"
                    spellCheck={false}
                  />
                </label>
                <label className="field port">
                  <span>포트</span>
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={draft.ssh.port ?? ''}
                    onChange={(e) => setSsh('port', e.target.value ? Number(e.target.value) : null)}
                    placeholder="22"
                  />
                </label>
              </div>

              <label className="field">
                <span>계정</span>
                <input
                  type="text"
                  value={draft.ssh.user}
                  onChange={(e) => setSsh('user', e.target.value)}
                  placeholder="원격 서버 사용자명"
                  spellCheck={false}
                />
              </label>

              <label className="field">
                <span>개인키 파일</span>
                <input
                  type="text"
                  value={draft.ssh.identityFile}
                  onChange={(e) => setSsh('identityFile', e.target.value)}
                  placeholder="비우면 ssh 기본 키 (~/.ssh/id_rsa 등)"
                  spellCheck={false}
                />
                <small>비우면 평소 쓰는 기본 키를 씁니다 (ssh-agent · ~/.ssh/config 도 그대로 따릅니다).</small>
              </label>

              <label className="field">
                <span>원격 경로</span>
                <input
                  type="text"
                  value={draft.ssh.root}
                  onChange={(e) => setSsh('root', e.target.value)}
                  placeholder="/home/build/release"
                  spellCheck={false}
                />
                <small>날짜 폴더들의 부모 경로. `~/release` 처럼 홈 기준도 됩니다.</small>
              </label>

              <p className="settings-note">
                원격 서버는 <b>읽기만</b> 합니다 (`ls` · `find` · `cat`). 파일을 내려받거나 고치지
                않습니다.
                <br />
                처음 접속하는 서버라면 터미널에서 한 번 <code>ssh</code> 로 접속해 호스트 키를
                등록해 두세요.
                <br />
                <b>비밀번호는 이 화면이 아니라 터미널에 묻습니다.</b> 키로 접속되지 않는 서버라면{' '}
                <code>npm run dev</code> 를 띄운 터미널 창에 프롬프트가 뜹니다 — 접속을 재사용하지
                않으므로 <b>명령마다 한 번씩</b> 묻습니다. 한 번만 겪고 끝내려면{' '}
                <code>ssh-copy-id</code> 로 공개키를 등록해 두세요.
              </p>
            </>
          )}

          {/* 제외 목록은 두 모드가 같은 뜻을 갖고 경로 형태만 다르다 — 한 칸으로 둔다 */}
          <label className="field">
            <span>제외 목록 파일</span>
            <input
              type="text"
              value={draft.mode === 'local' ? draft.localExclude : (draft.ssh.excludeFile ?? '')}
              onChange={(e) =>
                draft.mode === 'local'
                  ? edit({ localExclude: e.target.value })
                  : setSsh('excludeFile', e.target.value)
              }
              placeholder={
                draft.mode === 'local'
                  ? '비우면 접지 않습니다. 예: ./sample-code/exclude.txt'
                  : '비우면 접지 않습니다. 예: /home/build/exclude.txt'
              }
              spellCheck={false}
            />
            <small>
              여기 적힌 파일을 목록에서 <b>접어 둡니다</b> — 지우는 것이 아니라서, 접은 것 중에
              바뀐 파일이 있으면 <b>몇 개인지 함께 알립니다.</b>
              <br />
              항목은 <b>쉼표 또는 줄바꿈</b>으로 구분합니다. <code>*_bak.pc</code> 는 어느 폴더에
              있든, <code>ord/tmp</code> 는 그 아래 전부, <code>#</code> 로 시작하면 설명입니다.
              <br />
              {draft.mode === 'local'
                ? '상대 경로는 이 프로젝트 폴더 기준입니다.'
                : '원격 서버의 경로입니다 (~/ 로 시작해도 됩니다).'}{' '}
              고친 뒤에는 <b>새로고침</b>을 누르면 다시 읽습니다.
            </small>
          </label>

          {/* 스키마 폴더는 소스와 다른 자리에 있어 경로를 따로 받는다 */}
          <label className="field">
            <span>스키마 폴더</span>
            <input
              type="text"
              value={draft.mode === 'local' ? draft.localSchemaRoot : (draft.ssh.schemaRoot ?? '')}
              onChange={(e) =>
                draft.mode === 'local'
                  ? edit({ localSchemaRoot: e.target.value })
                  : setSsh('schemaRoot', e.target.value)
              }
              placeholder={
                draft.mode === 'local'
                  ? '비우면 스키마 비교가 안 보입니다. 예: ./sample-schema'
                  : '비우면 스키마 비교가 안 보입니다. 예: /data/db-schema'
              }
              spellCheck={false}
            />
            <small>
              데이터 스키마 덤프가 쌓이는 폴더입니다. 그 아래는 <b>환경 폴더</b>로 갈리고, 그 안에
              날짜별 파일이 하나씩 있습니다 (<code>snapshot_&lt;환경&gt;_&lt;날짜&gt;.txt</code>).
              <br />
              이름 규칙과 구분자는 <code>change/config.ts</code> 의 <code>SCHEMA</code> 에서
              정합니다.
            </small>
          </label>

          {/* 스키마 쪽 팀 공용 규칙 — 소스 쪽 제외 목록 파일과 같은 성격이다 */}
          <label className="field">
            <span>스키마 제외 목록 파일</span>
            <input
              type="text"
              value={
                draft.mode === 'local'
                  ? draft.localSchemaExclude
                  : (draft.ssh.schemaExcludeFile ?? '')
              }
              onChange={(e) =>
                draft.mode === 'local'
                  ? edit({ localSchemaExclude: e.target.value })
                  : setSsh('schemaExcludeFile', e.target.value)
              }
              placeholder={
                draft.mode === 'local'
                  ? '비우면 접지 않습니다. 예: ./sample-schema/exclude.txt'
                  : '비우면 접지 않습니다. 예: /data/db-schema/exclude.txt'
              }
              spellCheck={false}
            />
            <small>
              <b>팀이 함께 쓰는</b> 스키마 제외 규칙입니다. 대상이 파일 경로가 아니라{' '}
              <b>테이블과 그 안의 이름</b>인 것만 다르고 문법은 위 제외 목록 파일과 같습니다.
              <br />
              <code>TB_ORD_BAK</code> 테이블 통째 · <code>TB_ORD.ORD_MEMO</code> 그 컬럼만 ·{' '}
              <code>*.REG_DTM</code> 모든 테이블의 그 컬럼 · <code>IX_*_TMP</code> 이름이 맞는
              인덱스·제약
              <br />
              고친 뒤에는 <b>새로고침</b>을 누르면 다시 읽습니다.
            </small>
          </label>

          <label className="field">
            <span>내 스키마 제외 목록</span>
            <textarea
              className="my-exclude"
              rows={4}
              value={mySchemaExclude}
              onChange={(e) => onChangeMySchemaExclude(e.target.value)}
              placeholder={'한 줄에 하나씩 적습니다.\nTB_ORD_BAK\nTB_ORD.ORD_MEMO\n*.REG_DTM'}
              spellCheck={false}
            />
            <small>
              <b>이 브라우저에만 남고 바로 반영됩니다.</b> 문법은 위 스키마 제외 목록 파일과
              같습니다.
              <br />
              테이블 목록과 컬럼·제약·인덱스 줄의 <b>⊘</b> 버튼을 누르면 여기 한 줄로 들어옵니다.
            </small>
          </label>


          {/*
            내 제외 목록 — 위 "제외 목록 파일" 과 목적이 다르다.
            그쪽은 팀이 함께 쓰는 규칙이고, 이쪽은 지금 나만 잠깐 치우는 것이다.
          */}
          <label className="field">
            <span>내 제외 목록</span>
            <textarea
              className="my-exclude"
              rows={4}
              value={myExclude}
              onChange={(e) => onChangeMyExclude(e.target.value)}
              placeholder={'한 줄에 하나씩 적습니다.\nord/ord_bak.pc\n*_test.pc\ntmp'}
              spellCheck={false}
            />
            <small>
              <b>이 브라우저에만 남고 바로 반영됩니다</b> — 적용을 누르지 않아도 됩니다. 팀이 함께
              쓰는 위 <b>제외 목록 파일</b> 과 달리, 지금 나만 잠깐 치우고 싶을 때 씁니다.
              <br />
              문법은 위 파일과 같습니다 (<code>*_bak.pc</code> 는 어느 폴더에 있든,{' '}
              <code>ord/tmp</code> 는 그 아래 전부, <code>#</code> 로 시작하면 설명).
              <br />
              파일 목록의 <b>⊘</b> 버튼을 누르면 그 파일이 여기 한 줄로 들어옵니다.
            </small>
          </label>


          <label className="field">
            <span>소스 인코딩</span>
            <div className="btn-group">
              {TEXT_ENCODINGS.map((e) => (
                <button
                  key={e.value}
                  type="button"
                  className={`btn sm ${draft.encoding === e.value ? 'active' : ''}`}
                  onClick={() => edit({ encoding: e.value })}
                >
                  {e.label}
                </button>
              ))}
            </div>
            <small>
              <b>자동</b>은 UTF-8 로 읽어보고 깨지면 EUC-KR 로 봅니다. UNIX 에서 오래 관리된 Pro*C
              소스는 대개 EUC-KR 입니다. 한글이 깨져 보이면 <b>EUC-KR</b> 로 고정하세요.
            </small>
          </label>
        </div>

        <footer>
          {missing.length > 0 && <span className="settings-missing">{missing.join(', ')} 필요</span>}
          <div className="spacer" />
          <button type="button" className="btn sm" onClick={onClose}>
            취소
          </button>
          <button type="button" className="btn sm primary" onClick={apply} disabled={!canApply}>
            적용
          </button>
        </footer>
      </div>
    </div>
  )
}
