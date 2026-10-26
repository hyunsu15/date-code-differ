import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchSchemaComparison } from '../../api/client.ts'
import SchemaBand from './SchemaBand.tsx'
import SchemaTable from './SchemaTable.tsx'
import TableList from './TableList.tsx'
import AllSameNotice from '../files/AllSameNotice.tsx'
import { filterTables, summarize } from './schemaView.ts'
import { shownItems, splitSame } from '../../lib/changedFirst.ts'
import {
  applySchemaExclude,
  isSchemaExcluded,
  loadKindToggles,
  saveKindToggles,
  toggleSchemaExclude,
  type KindToggles,
} from './schemaExclude.ts'
import { envById, envColorClass, envPath } from '../settings/envFolder.ts'
import { changeLegend, sideNames } from './schemaWording.ts'
import FontSize from '../settings/FontSize.tsx'
import { num } from '../../lib/format.ts'
import { pushToast } from '../../lib/toast.ts'
import {
  SCHEMA_KINDS,
  SCHEMA_KIND_LABEL,
  type SchemaComparisonResponse,
  type SchemaKind,
  type SourceConfig,
} from '../../types.ts'

/** 설명의 첫 줄. 나머지는 툴팁으로 돌린다 */
const firstLine = (text: string): string => text.split(/\r?\n/)[0]?.trim() ?? ''

interface SchemaPaneProps {
  /** 환경 폴더를 **붙이지 않은** 프리셋 루트 — 스키마 위치는 `schemaRoot` 가 따로 든다 */
  source: SourceConfig
  leftEnvId: string
  rightEnvId: string
  /**
   * 헤더 컨트롤이 고른 **스키마 날짜**.
   *
   * 목록을 읽고 고르는 일은 App 이 한다 — 코드와 같은 자리에서 고르게 하려고
   * 컨트롤을 하나로 합쳤다. 여기서는 받은 날짜로 대조만 한다.
   */
  leftDate: string
  rightDate: string
  /** 날짜 목록을 한 번이라도 받았는지 — 아직이면 "없다" 대신 "읽는 중" 을 보여준다 */
  snapshotsLoaded: boolean
  listError: string | null
  loadingList: boolean
  showSidebar: boolean
  onToggleSidebar: () => void
  /** 내 스키마 제외 목록 원문 (App 이 들고 ⚙ 설정과 나눠 쓴다) */
  myExclude: string
  onChangeMyExclude: (text: string) => void
  /** 글자 크기는 코드 화면과 나눠 쓴다 (`features/settings/FontSize.tsx`) */
  codeFontSize: number
  onChangeFontSize: (next: number) => void
}

/**
 * 스키마 비교 화면.
 *
 * **좌우 선택(환경·날짜)은 코드 화면과 같은 헤더 컨트롤이 다룬다.** 고르는 자리를 두 벌
 * 두면 탭을 옮길 때마다 다시 골라야 하고, 같은 일을 하는 컨트롤이 살짝 다르게 생겨
 * 어색해진다. 목록만 모드에 따라 갈아 끼운다 — 스키마 덤프는 배포와 주기가 달라
 * 날짜가 코드와 다르기 때문이다.
 *
 * 이 화면이 갖는 것은 아래 3단(밴드·옵션바·본문)뿐이다. 코드의 무시 옵션(공백·주석)은
 * 스키마에 하나도 안 맞고, 스키마에는 종류 토글이 따로 있다.
 *
 * 접기는 세 겹이다 — 팀 규칙 파일 · 내 목록 · 종류 토글 (`schemaExclude.ts`).
 * 셋을 한 자리에서 얹고 숫자를 다시 내야 요약과 목록이 어긋나지 않는다.
 */
export default function SchemaPane({
  source,
  leftEnvId,
  rightEnvId,
  leftDate,
  rightDate,
  snapshotsLoaded,
  listError,
  loadingList,
  showSidebar,
  onToggleSidebar,
  myExclude,
  onChangeMyExclude,
  codeFontSize,
  onChangeFontSize,
}: SchemaPaneProps) {
  const leftEnv = envPath(leftEnvId)
  const rightEnv = envPath(rightEnvId)
  /**
   * 색 · 말 범례 — `추가` 가 무엇을 뜻하는지 실제 이름으로 푼다 (`schemaWording.changeLegend`).
   * 줄 색과 말이 늘 왼쪽 → 오른쪽으로 읽히므로, 그 왼쪽·오른쪽이 누구인지만 알려 주면 된다.
   */
  const legendNames = sideNames(
    { env: envById(leftEnvId).label, date: leftDate },
    { env: envById(rightEnvId).label, date: rightDate }
  )
  const legend = changeLegend(legendNames)
  /**
   * 범례 속 이름은 **열 머리와 같은 환경 색 태그**로 그린다 — `운영` 주황, `테스트` 하늘색.
   * 글자색만 바꾸면 주황 `운영` 이 주황 `변경` 과 섞여 보인다. 모양(태그)이 같아야 "이건 환경" 으로 읽힌다.
   */
  const sideTag = (side: 'left' | 'right') => (
    <span className={`side-tag ${envColorClass(side === 'left' ? leftEnvId : rightEnvId)}`}>
      {legendNames[side]}
    </span>
  )
  const configured = (source.schemaRoot ?? '').trim() !== ''

  const [comparison, setComparison] = useState<SchemaComparisonResponse | null>(null)
  const [compareError, setCompareError] = useState<string | null>(null)
  const [comparing, setComparing] = useState(false)

  const [query, setQuery] = useState('')
  /**
   * 동일한 테이블을 펼쳐 볼지 — 목록 맨 아래 "동일한 테이블 N개" 접힘 줄. 예전 "변경된 테이블만" 체크를 대신한다.
   * 날짜·환경을 바꾸면 다시 접힌다(코드 파일 목록과 같은 규칙).
   */
  const [sameOpen, setSameOpen] = useState(false)
  const [kind, setKind] = useState<SchemaKind | null>(null)
  const [showSame, setShowSame] = useState(false)
  const [showExcluded, setShowExcluded] = useState(false)
  const [kinds, setKinds] = useState<KindToggles>(loadKindToggles)
  const [selectedName, setSelectedName] = useState<string | null>(null)

  useEffect(() => {
    saveKindToggles(kinds)
  }, [kinds])

  /* ---------------- 대조 ---------------- */

  useEffect(() => {
    if (!configured || !leftDate || !rightDate) {
      setComparison(null)
      return
    }
    let alive = true
    setComparing(true)
    setCompareError(null)

    fetchSchemaComparison(source, leftEnv, rightEnv, leftDate, rightDate)
      .then((res) => alive && setComparison(res))
      .catch((e: Error) => {
        if (!alive) return
        setComparison(null)
        setCompareError(e.message)
      })
      .finally(() => alive && setComparing(false))

    return () => {
      alive = false
    }
  }, [source, leftEnv, rightEnv, leftDate, rightDate, configured])

  /*
    실패를 알림으로 띄운다.

    인라인 배너는 화면 위쪽에 있어서 목록을 보고 있으면 그냥 지나친다 — 실제로
    "스키마가 안 된다" 는 말이 나온 자리가 여기다. 같은 내용은 겹쳐 뜨지 않는다
    (`lib/toast.ts` 가 걸러 준다).
  */
  useEffect(() => {
    if (listError) pushToast('error', '스키마 날짜 목록을 읽지 못했습니다', listError)
  }, [listError])

  useEffect(() => {
    if (compareError) pushToast('error', '스키마를 대조하지 못했습니다', compareError)
  }, [compareError])

  useEffect(() => {
    if (!comparison || comparison.malformed === 0) return

    // 한 줄도 못 읽었으면 화면이 통째로 비어 있다 — 경고가 아니라 오류다
    const dead = comparison.tables.length === 0
    const sample = comparison.malformedSample.map((line) => `  ${line}`).join('\n')

    pushToast(
      dead ? 'error' : 'warn',
      dead
        ? `스키마를 한 줄도 읽지 못했습니다 (${comparison.malformed}줄)`
        : `못 읽은 줄이 ${comparison.malformed}개 있습니다`,
      [comparison.malformedHint, sample && `파일에는 이렇게 적혀 있습니다:\n${sample}`]
        .filter(Boolean)
        .join('\n\n')
    )
  }, [comparison])

  // 규칙 파일을 못 읽은 것은 조용히 넘어가면 안 된다 —
  // 접힌 줄 알았던 것이 그냥 다 보이고 있는 상태다
  useEffect(() => {
    if (comparison?.exclude.error) {
      pushToast('warn', '스키마 제외 목록 파일을 읽지 못했습니다', comparison.exclude.error)
    }
  }, [comparison])

  /* ---------------- 접기 ---------------- */

  const excluded = useMemo(
    () =>
      applySchemaExclude(
        comparison?.tables ?? [],
        comparison?.exclude.rules ?? [],
        myExclude,
        kinds
      ),
    [comparison, myExclude, kinds]
  )

  const tables = excluded.tables
  const summary = useMemo(() => summarize(tables), [tables])
  /**
   * 바뀐 테이블 · 동일한 테이블 두 묶음. 동일한 것은 펼쳤거나 검색 중일 때만 보인다 —
   * **검색은 접기와 상관없이 전체에서** 찾는다(컬럼 이름까지).
   */
  const searching = query.trim() !== ''
  const groups = useMemo(
    () => splitSame(filterTables(tables, { query, onlyChanged: false, kind, showExcluded })),
    [tables, query, kind, showExcluded]
  )
  const visible = useMemo(
    () => shownItems(groups.changed, groups.same, sameOpen, searching),
    [groups, sameOpen, searching]
  )

  // 날짜·환경이 바뀌면(= 다른 대조) 동일한 테이블은 다시 접는다
  useEffect(() => {
    setSameOpen(false)
  }, [leftEnv, rightEnv, leftDate, rightDate])

  // 고른 테이블이 걸러져 사라지면 첫 항목으로 옮긴다 — 빈 화면을 남기지 않는다
  const selected = visible.find((t) => t.name === selectedName) ?? visible[0] ?? null
  useEffect(() => {
    if (selected && selected.name !== selectedName) setSelectedName(selected.name)
  }, [selected, selectedName])

  /**
   * 되돌리기가 볼 최신 목록 — 알림은 몇 초 뒤에 눌리므로 누른 그때의 목록에서 빼야 한다
   * (만들 때 목록을 붙잡아 두면 그사이 넣은 것까지 함께 날아간다).
   */
  const latestExclude = useRef(myExclude)
  latestExclude.current = myExclude

  /**
   * 목록·표에서 한 번 눌러 접거나 펼친다.
   * 접으면 바로 사라지므로 무엇을 접었는지와 되돌리기를 알림으로 준다 (코드 파일 목록과 같다).
   */
  const toggleExclude = useCallback(
    (table: string, member?: string) => {
      const adding = !isSchemaExcluded(myExclude, table, member)
      onChangeMyExclude(toggleSchemaExclude(myExclude, table, member))
      if (!adding) return
      const name = member === undefined ? table : `${table}.${member}`
      pushToast('info', `내 스키마 제외 목록에 넣었습니다 — ${name}`, undefined, {
        label: '되돌리기',
        run: () => {
          const text = latestExclude.current
          // 그사이 손으로 뺐으면 다시 넣지 않는다 (토글이라 두 번 돌면 도로 들어간다)
          if (isSchemaExcluded(text, table, member)) {
            onChangeMyExclude(toggleSchemaExclude(text, table, member))
          }
        },
      })
    },
    [myExclude, onChangeMyExclude]
  )

  /** 접힌 것 전부 — 테이블과 줄을 합쳐 센다 */
  const hidden = excluded.excludedTables + excluded.excludedRows
  const hiddenChanged = excluded.excludedTablesChanged + excluded.excludedRowsChanged

  /* ---------------- 설정을 아직 안 채운 경우 ---------------- */

  if (!configured) {
    return (
      <div className="empty">
        <h2>스키마 위치가 설정돼 있지 않습니다</h2>
        <p>
          <code>change/config.ts</code> 의 프리셋에 <b>schemaRoot</b> 를 적으면 켜집니다.
          <br />
          그 아래는 환경 폴더로 갈리고, 그 안에 날짜별 파일이 하나씩 있습니다.
          <br />
          <code>
            &lt;schemaRoot&gt;/{leftEnv || '<환경>'}/snapshot_{leftEnv || '<환경>'}_2026-09-01.txt
          </code>
        </p>
      </div>
    )
  }

  /* ---------------- 날짜를 못 고른 경우 ---------------- */

  if (!leftDate || !rightDate) {
    return (
      <div className="empty">
        <h2>{loadingList ? '스키마 날짜를 읽는 중…' : '견줄 스키마 날짜가 없습니다'}</h2>
        <p>
          {loadingList ? (
            <>위에서 고른 환경의 스키마 파일을 찾고 있습니다.</>
          ) : snapshotsLoaded ? (
            <>
              같은 환경끼리 견주려면 그 환경에 스키마 파일이 <b>2개 이상</b> 있어야 합니다.
              <br />
              위에서 한쪽 환경을 바꾸면 다른 환경과 견줄 수 있습니다.
            </>
          ) : (
            <>
              <code>{`${(source.schemaRoot ?? '').trim()}/${leftEnv}`}</code> 아래에 스키마
              파일이 없습니다.
              <br />
              파일 이름이 <code>change/config.ts</code> 의 <b>SCHEMA.fileName</b> 규칙과 맞는지
              확인하세요.
            </>
          )}
        </p>
      </div>
    )
  }

  return (
    <>
      <SchemaBand
        summary={summary}
        kind={kind}
        onSelectKind={setKind}
        loading={loadingList || comparing}
      />

      {/*
        좌우 설명이 다르면 그것도 변경이다 — 한쪽만 보여주면 조용히 묻힌다.

        다만 **첫 줄만** 편다. 파일 맨 위 주석에는 형식 설명·담당자 같은 것이 얼마든지
        들어갈 수 있어서, 그대로 펴면 이 한 줄이 화면 위쪽을 통째로 먹는다.
        나머지는 마우스를 올리면 보인다.
      */}
      {comparison && (comparison.leftDescription || comparison.rightDescription) && (
        <div
          className={`schema-desc ${
            comparison.leftDescription !== comparison.rightDescription ? 'differs' : ''
          }`}
          title={
            comparison.leftDescription === comparison.rightDescription
              ? comparison.leftDescription
              : `${envById(leftEnvId).label} ${leftDate}\n${comparison.leftDescription || '(없음)'}\n\n` +
                `${envById(rightEnvId).label} ${rightDate}\n${comparison.rightDescription || '(없음)'}`
          }
        >
          <span className="label">설명</span>
          {comparison.leftDescription === comparison.rightDescription ? (
            <span className="same">{firstLine(comparison.leftDescription)}</span>
          ) : (
            <>
              <span className="one">{firstLine(comparison.leftDescription) || '(없음)'}</span>
              <span className="arrow">→</span>
              <span className="one">{firstLine(comparison.rightDescription) || '(없음)'}</span>
            </>
          )}
        </div>
      )}

      <div className="optionbar">
        <div className="group">
          <span className="label">줄</span>
          <div className="btn-group">
            <button
              type="button"
              className={`btn sm ${showSame ? '' : 'active'}`}
              onClick={() => setShowSame(false)}
              title="바뀐 컬럼·제약·인덱스만 보여줍니다"
            >
              변경만
            </button>
            <button
              type="button"
              className={`btn sm ${showSame ? 'active' : ''}`}
              onClick={() => setShowSame(true)}
              title="테이블 정의 전체를 보여줍니다"
            >
              전체
            </button>
          </div>
        </div>

        <div className="divider" />

        {/* 종류를 통째로 끄는 자리 — "이번 배포는 인덱스 성능 얘기라 안 본다" 가 잦다 */}
        <div className="group">
          <span className="label">종류</span>
          {SCHEMA_KINDS.map((k) => (
            <label key={k} className="toggle">
              <input
                type="checkbox"
                checked={kinds[k]}
                onChange={(e) => setKinds((prev) => ({ ...prev, [k]: e.target.checked }))}
              />
              {SCHEMA_KIND_LABEL[k]}
            </label>
          ))}
        </div>

        <div className="divider" />

        <FontSize value={codeFontSize} onChange={onChangeFontSize} />

        {comparison && comparison.malformed > 0 && (
          <>
            <div className="divider" />
            <span
              className="excl-error"
              title={
                '줄 앞머리 [COLUMN] · [CONSTRAINT] · [INDEX] 로 종류를 알아보지 못한 줄입니다.\n' +
                'change/config.ts 의 SCHEMA.separator 가 덤프의 구분자와 맞는지 확인하세요.'
              }
            >
              ⚠ 못 읽은 줄 {comparison.malformed}
            </span>
          </>
        )}

        <div style={{ flex: 1 }} />

        <button type="button" className="btn sm" onClick={onToggleSidebar}>
          {showSidebar ? '◧ 목록 숨기기' : '▣ 목록 보기'}
        </button>
      </div>

      <div className={`main ${showSidebar ? '' : 'no-sidebar'}`}>
        {showSidebar && (
          <aside className="sidebar">
            <div className="filter">
              <input
                className="search"
                type="search"
                placeholder="테이블·컬럼 이름 검색"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            <div className="filelist-head">
              {searching ? '찾은 바뀐 테이블' : '바뀐 테이블'} <b>{groups.changed.length}</b>개
              {kind && <span className="pkg-filter">· 종류 필터</span>}
              {excluded.offKinds.length > 0 && (
                <span className="pkg-filter">
                  · {excluded.offKinds.map((k) => SCHEMA_KIND_LABEL[k]).join('·')} 끔
                </span>
              )}
              {/* 접은 것을 조용히 지우지 않는다 — 그중 바뀐 것이 있으면 따로 알린다 */}
              {hidden > 0 && (
                <button
                  type="button"
                  className={`excl-toggle ${showExcluded ? 'on' : ''}`}
                  onClick={() => setShowExcluded((v) => !v)}
                  title={[
                    comparison?.exclude.file
                      ? `규칙 파일(${comparison.exclude.file}) ${comparison.exclude.rules.length}개`
                      : '규칙 파일 없음',
                    excluded.byMine > 0 ? `내 목록 ${excluded.byMine}개` : null,
                    `테이블 ${excluded.excludedTables} · 줄 ${excluded.excludedRows} 을 접었습니다.`,
                    hiddenChanged > 0
                      ? `그중 ${hiddenChanged}개는 실제로 바뀌었습니다 — 눌러서 확인하세요.`
                      : '눌러서 펼쳐 볼 수 있습니다.',
                  ]
                    .filter(Boolean)
                    .join('\n')}
                >
                  · 제외 {num(hidden)}
                  {excluded.byMine > 0 && <i className="mine"> (내 {excluded.byMine})</i>}
                  {hiddenChanged > 0 && <b> · 변경 {hiddenChanged}</b>}
                </button>
              )}
            </div>

            <TableList
              tables={groups.changed}
              same={groups.same}
              sameOpen={sameOpen}
              searching={searching}
              onToggleSame={() => setSameOpen((v) => !v)}
              selectedName={selected?.name ?? null}
              onSelect={setSelectedName}
              onToggleExclude={toggleExclude}
              emptyMessage={
                comparing
                  ? '읽는 중…'
                  : tables.length === 0
                    ? '읽어 온 테이블이 없습니다.'
                    : hidden > 0 && !showExcluded
                      ? '보이는 테이블이 모두 접혀 있습니다. 위의 "제외" 를 눌러 펼쳐 보세요.'
                      : '조건에 맞는 테이블이 없습니다.'
              }
            />
          </aside>
        )}

        <section className="viewer">
          {selected ? (
            <>
              <div className="file-title schema-title">
                <b>{selected.name}</b>
                {selected.excluded && (
                  <span className="badge s-excluded">
                    {selected.excludedLocal ? '내 제외' : '제외'}
                  </span>
                )}
                {selected.primaryKeyChanged && <span className="badge s-pk">⚠ 기본키 변경</span>}

                {/* 줄 색과 말의 뜻 — 바로 아래 줄들을 읽을 때 눈이 가는 자리에 둔다 */}
                <span
                  className="schema-legend"
                  title={
                    '왼쪽 → 오른쪽(위 화살표 방향)으로 읽은 말입니다.\n' +
                    '환경이 다를 때는 어느 쪽이 맞는 상태인지 판단하지 않습니다 — 한쪽에 있고 다른 쪽에 없다는 뜻입니다.'
                  }
                >
                  {legend.map((item) => (
                    <span key={item.status} className={`lg s-${item.status}`}>
                      <i className="sw" aria-hidden="true" />
                      <b>{item.word}</b>
                      {/* 한 덩어리 글줄로 둔다 — 태그와 조사(에는) 사이가 벌어지지 않게 */}
                      <span className="mean">
                        {item.has ? (
                          <>
                            {sideTag(item.has)}에는 있고{' '}
                            {sideTag(item.has === 'left' ? 'right' : 'left')}에는 없음
                          </>
                        ) : (
                          item.meaning
                        )}
                      </span>
                    </span>
                  ))}
                </span>
              </div>

              <SchemaTable
                table={selected}
                leftLabel={`${envById(leftEnvId).label} ${leftDate}`}
                rightLabel={`${envById(rightEnvId).label} ${rightDate}`}
                leftTagClass={envColorClass(leftEnvId)}
                rightTagClass={envColorClass(rightEnvId)}
                showSame={showSame}
                showExcluded={showExcluded}
                onToggleExclude={(member) => toggleExclude(selected.name, member)}
              />
            </>
          ) : comparison && !comparing && groups.changed.length === 0 && groups.same.length > 0 ? (
            <AllSameNotice
              count={groups.same.length}
              noun="테이블"
              excluded={showExcluded ? 0 : excluded.excludedTables}
              sameDate={leftEnvId === rightEnvId && leftDate === rightDate ? leftDate : null}
              onOpen={() => setSameOpen(true)}
            />
          ) : (
            <div className="empty">
              <h2>{comparing ? '읽는 중…' : '볼 테이블이 없습니다'}</h2>
              <p>위에서 좌우의 환경·날짜를 고르면 그 시점의 스키마를 견줍니다.</p>
            </div>
          )}
        </section>
      </div>
    </>
  )
}
