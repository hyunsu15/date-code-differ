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
    ssh: source.mode === 'ssh' ? source : DEFAULT_SSH_SOURCE,
    encoding: source.encoding,
  }
}

function draftSource(draft: Draft): SourceConfig {
  if (draft.mode === 'local') {
    return { mode: 'local', root: draft.localRoot.trim(), encoding: draft.encoding }
  }
  return {
    ...draft.ssh,
    host: draft.ssh.host.trim(),
    user: draft.ssh.user.trim(),
    identityFile: draft.ssh.identityFile.trim(),
    root: draft.ssh.root.trim(),
    encoding: draft.encoding,
  }
}

/**
 * 비교 대상 위치 설정.
 *
 * 프리셋은 `change/config.ts` 에서 온다. 값을 직접 고치면 "직접 입력"으로 바뀌고
 * 이 브라우저의 localStorage 에만 저장된다.
 */
export default function SettingsPanel({ value, onApply, onClose }: SettingsPanelProps) {
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
                <span>인증 방식</span>
                <div className="btn-group">
                  <button
                    type="button"
                    className={`btn sm ${draft.ssh.auth === 'key' ? 'active' : ''}`}
                    onClick={() => setSsh('auth', 'key')}
                  >
                    개인키
                  </button>
                  <button
                    type="button"
                    className={`btn sm ${draft.ssh.auth === 'password' ? 'active' : ''}`}
                    onClick={() => setSsh('auth', 'password')}
                  >
                    비밀번호
                  </button>
                </div>
                {draft.ssh.auth === 'password' && (
                  <small>
                    비밀번호는 <b>여기에 넣지 않습니다.</b> 적용한 뒤 터미널에서{' '}
                    <code>npm run ssh-login</code> 을 실행해 입력하세요. 입력한 값은 개발 서버
                    메모리에만 남고 브라우저·저장소에는 저장되지 않습니다.
                  </small>
                )}
              </label>

              <label className="field" style={{ opacity: draft.ssh.auth === 'key' ? 1 : 0.45 }}>
                <span>개인키 파일</span>
                <input
                  type="text"
                  value={draft.ssh.identityFile}
                  onChange={(e) => setSsh('identityFile', e.target.value)}
                  placeholder="비우면 ssh 기본 키 (~/.ssh/id_rsa 등)"
                  spellCheck={false}
                  disabled={draft.ssh.auth !== 'key'}
                />
                <small>
                  {draft.ssh.auth === 'key'
                    ? '비우면 평소 쓰는 기본 키를 씁니다.'
                    : '비밀번호 인증에서는 쓰이지 않습니다.'}
                </small>
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
              </p>
            </>
          )}

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
