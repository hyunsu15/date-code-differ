import path from 'node:path'
import { LocalSource } from './localSource.ts'
import { SshSource } from './sshSource.ts'
import { SourceError, type SnapshotSource } from './types.ts'
import type { SourceConfig } from '../../src/types.ts'

/**
 * 설정을 실제 소스 구현으로 바꾼다.
 *
 * @param projectRoot 로컬 상대 경로를 풀 기준 (프로젝트 폴더)
 */
export function createSource(config: SourceConfig, projectRoot: string): SnapshotSource {
  if (config.mode === 'ssh') {
    const missing = (['host', 'user', 'root'] as const).filter((k) => !config[k].trim())
    if (missing.length > 0) {
      throw new SourceError(
        `SSH 설정이 비어 있습니다: ${missing.join(', ')}. change/config.ts 를 확인하세요.`,
        'SSH_CONFIG_INCOMPLETE'
      )
    }
    return new SshSource(config)
  }

  const root = config.root.trim()
  if (!root) {
    throw new SourceError(
      '폴더 경로가 비어 있습니다. change/config.ts 의 프리셋을 확인하세요.',
      'LOCAL_ROOT_EMPTY'
    )
  }
  // `./sample-code` 같은 상대 경로는 프로젝트 폴더 기준으로 푼다
  return new LocalSource(path.resolve(projectRoot, root), config.encoding)
}

/**
 * 캐시 키 — 소스가 다르면 같은 날짜 이름이라도 다른 결과다.
 * 인코딩이 다르면 같은 파일도 다른 내용으로 읽히므로 함께 넣는다.
 * 개인키는 **경로**만 들어간다 (키 내용이나 비밀번호는 애초에 다루지 않는다).
 */
export function sourceKey(config: SourceConfig, projectRoot: string): string {
  if (config.mode === 'ssh') {
    return [
      'ssh',
      config.user,
      config.host,
      config.port ?? '',
      config.identityFile,
      config.root,
      config.encoding,
    ].join(' ')
  }

  const root = config.root.trim()
  return ['local', root ? path.resolve(projectRoot, root) : '', config.encoding].join(' ')
}
