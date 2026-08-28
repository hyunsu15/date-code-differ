# Apple UX Guide

## Philosophy

Apple UX의 핵심 목표는

> 사용자가 인터페이스를 인식하지 못할 정도로 자연스러운 경험을 제공하는 것

좋은 UX는 사용자가 기능을 배우지 않아도 사용할 수 있어야 한다.

---

# 4. Immediate Feedback

## Principle

모든 행동에는 즉각적인 피드백이 필요하다.

---

## Good

```text
저장 중...
저장 완료
```

---

## Bad

버튼 클릭 후 아무 반응 없음

---

# 6. Forgiveness

## Principle

실수는 발생한다.

사용자가 복구할 수 있어야 한다.

---

## Good

```text
삭제됨

[실행 취소]
```

---

## Bad

```text
삭제 완료
```

복구 불가

---

## Rule

* Undo 제공
* 휴지통 제공
* 자동 저장 제공

---

# 13. Error Handling

## Principle

오류보다 해결책이 중요하다.

---

## Good

```text
파일 업로드 실패

파일 크기가 50MB를 초과했습니다.
```

---

## Bad

```text
Error 500
```

---

## Rule

항상 해결 방법 제시

---

# 14. Loading Experience

## Principle

기다림을 느끼지 않게 한다.

---

## Preferred

Skeleton UI

---

## Acceptable

Loading...

---

## Avoid

빈 화면

---

# 15. Navigation

## Principle

현재 위치와 다음 위치를 항상 알 수 있어야 한다.

---

## User should know

* 내가 어디 있는가
* 어디로 갈 수 있는가
* 어떻게 돌아가는가

---

# 17. Accessibility

## Principle

모든 사용자가 사용할 수 있어야 한다.

---

## Requirements

* VoiceOver 지원
* Dynamic Type 지원
* 충분한 명암비
* 44x44 터치 영역

---

# 18. Gesture Patterns

## Principle

제스처는 빠르고 직관적이지만, 발견하기 어렵다. 반드시 시각적 단서와 병행 제공한다.

---

## Standard Gestures

| 제스처 | 동작 | 적용 대상 |
| ------ | ---- | --------- |
| 좌에서 우로 스와이프 (엣지) | 이전 화면으로 돌아가기 | Navigation 전체 |
| 아래로 스와이프 | Sheet/Modal 닫기 | Bottom Sheet, 전체화면 Modal |
| 위로 당기기 (Pull) | 새로고침 | 스크롤 최상단 목록 |
| 좌/우 스와이프 (셀) | 숨겨진 액션 노출 (삭제, 보관) | List Item |
| 길게 누르기 (Long Press) | 컨텍스트 메뉴 표시 | 카드, 셀, 이미지 |

---

## Rules

* 엣지 스와이프는 절대 막지 않는다 — 브라우저 뒤로가기와 충돌 시 사용자는 혼란을 느낀다.
* 스와이프 삭제는 반드시 확인 단계 또는 Undo를 함께 제공한다 (6. Forgiveness 참고).
* Pull-to-Refresh는 스크롤이 최상단(scrollTop === 0)일 때만 작동한다.
* 제스처만으로 접근 가능한 기능은 반드시 버튼 대안도 제공한다 (Accessibility).
* **Long Press를 유일한 진입점으로 쓰지 않는다.** Apple HIG는 숨겨진 메뉴를 여는 롱프레스의 대안(메뉴 항목을 다른 곳에 함께 배치)을 권장한다 — 발견 가능성(discoverability)이 낮기 때문이다. 출처: Context Menus HIG — https://developer.apple.com/design/human-interface-guidelines/context-menus

---

# 19. Sheet & Modal Presentation

## Principle

Sheet는 현재 컨텍스트를 유지한 채 보조 작업을 수행할 때 사용한다.
Modal은 컨텍스트를 완전히 차단해야 할 때만 사용한다.

> Apple HIG(Sheets): "A sheet helps people perform a scoped task that's closely related to their current context." 출처: https://developer.apple.com/design/human-interface-guidelines/sheets
> (아래 "언제 무엇을 쓸까" 표는 HIG 원칙을 바탕으로 이 가이드가 정리한 실무 매핑이며, Apple의 공식 결정표는 아니다.)

---

## 언제 무엇을 쓸까

| 상황 | 패턴 |
| ---- | ---- |
| 필터, 정렬, 간단한 설정 | Bottom Sheet (Medium Detent) |
| 양식 작성, 긴 콘텐츠 | Bottom Sheet (Large Detent) |
| 돌이킬 수 없는 확인 (삭제, 결제) | Alert / Action Sheet |
| 완전히 별개의 흐름 | Full Screen Modal |

---

## Dismiss 규칙

* 아래로 스와이프 → 항상 닫힘
* 배경 탭 → 닫힘 (입력 중이면 확인 후 닫힘)
* 저장이 필요한 Sheet는 닫기 버튼에 "취소"를 명시

---

## Good

```text
[필터]
─────────────────
카테고리
가격 범위
평점
─────────────────
[적용]
```

---

## Bad

* 필터를 전체 화면 페이지 이동으로 처리
* Sheet 안에 또 다른 Sheet 중첩
* 배경 탭으로 닫히지 않는 non-dismissible Sheet (특별한 이유 없이)

---

# UX Checklist

## Clarity

* [ ] 사용자가 목적을 즉시 이해 가능한가
* [ ] 주요 행동이 명확한가

## Simplicity

* [ ] 불필요한 요소 제거
* [ ] 선택지 최소화

## Feedback

* [ ] 모든 행동에 반응 제공
* [ ] 로딩 상태 표시

## Recovery

* [ ] Undo 제공
* [ ] 오류 복구 가능

## Navigation

* [ ] 현재 위치 표시
* [ ] 뒤로가기 가능

## Gestures

* [ ] 엣지 스와이프(뒤로가기) 차단 없음
* [ ] 제스처 전용 기능에 버튼 대안 제공
* [ ] Pull-to-Refresh는 스크롤 최상단에서만 작동

## Sheet & Modal

* [ ] 아래 스와이프로 Sheet 닫기 가능
* [ ] Sheet 중첩 없음
* [ ] 파괴적 액션은 Alert/Action Sheet 사용

## Performance

* [ ] 100ms 이내 시각 반응
* [ ] Skeleton 제공

## Accessibility

* [ ] 키보드 사용 가능
* [ ] 스크린 리더 지원
* [ ] 터치 영역 44px 이상

---

# 비공식 (공식 문서 미수록 · 일반 UX 원칙)

아래 항목은 공식 Apple HIG에서 확인되지 않은 일반 UX·HCI 원칙(주로 Nielsen 휴리스틱, Miller's law 등)이거나 Apple 공식 명칭이 아닌 것이다. 개념적으로 유용하나 Apple 공식 출처는 없다.

---

# 1. Content First — 비공식

## Principle

UI보다 콘텐츠가 중요하다.

사용자는 버튼을 보기 위해 앱을 사용하는 것이 아니라 목표를 달성하기 위해 앱을 사용한다.

---

## Good

* 콘텐츠를 먼저 보여준다.
* 장식 요소를 최소화한다.
* 사용자의 목표에 집중한다.

---

## Bad

* 과도한 애니메이션
* 장식용 UI
* 의미 없는 시각 효과

---

# 2. One Primary Action — 비공식

## Principle

한 화면에는 하나의 주요 행동만 존재해야 한다.

---

## Good

```text
저장
```

---

## Bad

```text
저장
수정
공유
삭제
내보내기
복사
```

모든 액션이 동일한 중요도를 가져서는 안 된다.

---

# 3. Recognition Over Recall — 비공식

## Principle

사용자가 기억하게 하지 말고 보여줘라.

---

## Good

```text
최근 검색
최근 방문
최근 파일
```

---

## Bad

```text
검색어를 기억하세요
```

---

## Rule

* 최근 기록 제공
* 자동 완성 제공
* 추천 제공

---

# 4. Immediate Feedback (Rule) — 비공식

## Rule

100ms 이내 (Nielsen 기준 Instant 범위 — 16. Performance UX 참고)

사용자는 시스템이 즉각 반응했다고 느껴야 한다. 100ms를 초과하면 지연을 인식한다.

---

# 5. Progressive Disclosure — 비공식

## Principle

필요한 정보만 보여준다.

---

## Good

```text
기본 정보
▼ 상세 설정
```

---

## Bad

초기 화면에 모든 옵션 표시

---

## Rule

초보자는 단순하게

고급 사용자는 확장 가능하게

---

# 7. Direct Manipulation — 비공식

## Principle

사용자가 객체를 직접 다루는 느낌을 줘야 한다.

---

## Good

* 드래그
* 스와이프
* 확대/축소

---

## Bad

설정 메뉴를 여러 단계 거쳐야 함

---

# 8. Reduce Cognitive Load — 비공식

## Principle

생각할 거리를 줄인다.

---

## Rule

### 선택지는 7개 이하

```text
추천
```

### 단계 수 최소화

```text
3단계 이하 권장
```

---

## Bad

10개 이상의 선택지

---

# 9. Consistency — 비공식

## Principle

동일한 행동은 동일한 결과를 가져야 한다.

---

## Example

```text
← 뒤로
```

모든 화면에서 동일하게 동작

---

## Avoid

같은 버튼이 화면마다 다른 역할 수행

---

# 10. User Control — 비공식

## Principle

사용자가 통제권을 가져야 한다.

---

## Good

* 취소 가능
* 되돌리기 가능
* 설정 변경 가능

---

## Bad

강제 진행

---

# 11. Context Preservation — 비공식

## Principle

사용자의 현재 위치를 잃게 하지 않는다.

---

## Good

```text
프로젝트
 └ 파일
    └ 메서드
```

---

## Good

* Breadcrumb
* 현재 위치 표시
* 선택 상태 유지

---

# 12. Empty States — 비공식

## Principle

빈 화면도 UX다.

---

## Good

```text
아직 파일이 없습니다.

[파일 추가]
```

---

## Bad

빈 흰 화면

---

# 16. Performance UX — 비공식

## Principle

빠른 UX는 기능보다 중요하다.

---

## Targets

### Instant

```text
0~100ms
```

---

### Responsive

```text
100~300ms
```

---

### Noticeable

```text
300~1000ms
```

---

### Waiting

```text
1초 이상
```

Progress 표시 필요

---

# 18. Gesture Patterns (Rule) — 비공식

## Rule

Long Press 메뉴는 최대 5개 항목 이내로 구성한다.

---

# 출처

확인일 2026-07-03. 공식 항목은 Apple HIG/developer.apple.com 기준이며, "비공식"으로 표시된 원칙은 일반 UX·HCI(Nielsen 휴리스틱 등)로 Apple 공식 출처가 없다.

- Sheet 정의/사용: https://developer.apple.com/design/human-interface-guidelines/sheets
- Context Menus / Long Press 대안 권장: https://developer.apple.com/design/human-interface-guidelines/context-menus
- 접근성(VoiceOver·Dynamic Type·44pt): https://developer.apple.com/design/human-interface-guidelines/accessibility · https://developer.apple.com/design/tips/
- 제스처(Pull-to-Refresh·스와이프 액션 등, SwiftUI Lists): https://developer.apple.com/documentation/swiftui/lists

> 검증 방식 주의: HIG(`.../human-interface-guidelines/*`) 페이지는 JS 렌더링(SPA)이라 정적 fetch로 본문 확인이 제한된다. 위 항목은 공식 도메인 검색 색인·API 레퍼런스로 교차 확인했다.
