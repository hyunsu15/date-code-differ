# Google Style UI Guide (Material Design 3)

> **충돌 시 우선순위:** 이 문서의 규칙이 `AppleUI가이드.md`와 충돌하면 `UI-UX-가이드라인.md`의 충돌표를 따른다. 확정 항목 — 터치 영역 44×44pt(=CSS 44px), 그리드 8px 배수(AppleUI 우선; Material 원규격은 4dp/8dp), 애니메이션은 기능 설명용으로 쓰지 않음.

## 1. Design Principles

M3 공식 핵심 원칙은 **Personal · Adaptive · Expressive** 세 가지다. (접근성은 별도의 기반 요구사항으로 §13에서 다룬다.) 출처: https://m3.material.io/foundations/overview/principles

### Personal

* 사용자의 취향(테마·색상)에 맞춰 개인화된다 — Dynamic Color 등.

### Adaptive

* 다양한 기기 환경에 대응한다.
* 모바일, 태블릿, 데스크톱을 동일한 경험으로 연결한다.

### Expressive

* 브랜드와 사용자의 개성을 표현할 수 있다.
* 색상과 형태를 적극 활용한다.

---

# 2. Layout

## Grid System

기본 단위

```text
8dp Grid (4dp는 아이콘·타이포용 보조 그리드)
```

출처: https://m3.material.io/styles/spacing/overview

---

## Responsive Breakpoints

Material 3 공식 명칭은 window size class다. (단위 dp)

| Size class | Width (dp)   | 대표 기기 |
| ---------- | ------------ | -------- |
| Compact     | < 600        | 세로 폰 |
| Medium      | 600 ~ 839    | 세로 태블릿·폴더블 |
| Expanded    | 840 ~ 1199   | 가로 태블릿, 소형 데스크톱 |
| Large       | 1200 ~ 1599  | 데스크톱 |
| Extra-large | ≥ 1600       | 울트라와이드, 외부 디스플레이 |

---

# 3. Typography

## Font

우선순위

```text
Roboto
Google Sans
system-ui
sans-serif
```

---

## Type Scale

| Style          | Size |
| -------------- | ---- |
| Display Large  | 57px |
| Display Medium | 45px |
| Headline Large | 32px |
| Title Large    | 22px |
| Body Large     | 16px |
| Body Medium    | 14px |
| Label Large    | 14px |

---

> M3는 위 15종 baseline 타입 스케일 외에, 더 굵은 웨이트의 **Emphasized** 15종 스타일을 추가 제공한다(강조 영역에 선택적 사용). 출처: https://m3.material.io/styles/typography/type-scale-tokens

## Rules

* 시각적 계층 구조 유지
* 5~7개 타입 스케일 이내 유지
* 지나친 Bold 사용 금지

---

# 4. Color System

## Primary

```css
#6750A4
```

## Secondary

```css
#625B71
```

## Tertiary

```css
#7D5260
```

## Error

```css
#B3261E
```

---

## Surface

```css
#FFFBFE
```

## Background

```css
#FFFBFE
```

---

## Rules

* Surface 기반 설계
* 색상은 의미 전달용
* 다크모드 필수 지원

---

# 5. Elevation

## Levels

| Level | Shadow   |
| ----- | -------- |
| 0     | 없음       |
| 1     | 약한 그림자   |
| 2     | 카드       |
| 3     | 드롭다운     |
| 4     | 모달       |
| 5     | 최상위 오버레이 |

---

## Tonal Surface Color (현행 모델)

> ⚠️ **중요 업데이트:** M3는 **surfaceTint 오버레이 방식을 폐기(deprecated)** 했다. 현재는 elevation과 분리된 **surface container 색상 역할**로 표면 위계를 표현한다. 출처: https://m3.material.io/blog/tone-based-surface-color-m3

표면의 계층은 다음 5단계 tonal surface container 역할로 나타낸다(불투명도 오버레이 아님).

| Surface Role             | 용도(대략)                    |
| ------------------------ | ----------------------------- |
| `surfaceContainerLowest` | 가장 낮은 표면                |
| `surfaceContainerLow`    | 구 elevation +1 (Elevated Card 등) |
| `surfaceContainer`       | 구 elevation +2 (기본 컨테이너) |
| `surfaceContainerHigh`   | 구 elevation +3 (Dialog 등)   |
| `surfaceContainerHighest`| 최상위 표면 (구 +4/+5, `surfaceDim`도 함께 사용) |

```css
/* Elevated Card — surface container 역할 사용 (오버레이 계산 불필요) */
.card-elevated { background-color: var(--md-sys-color-surface-container-low); }

/* Dialog */
.dialog { background-color: var(--md-sys-color-surface-container-high); }
```

### (Deprecated) 구 surfaceTint 오버레이 모델 — 참고용

아래는 **2024년 이전** M3에서 쓰던 방식으로, 현재는 폐기되었다. 레거시 코드 이해용으로만 남긴다.

| Level | surfaceTint Opacity | 적용 컴포넌트 예시          |
| ----- | ------------------- | --------------------------- |
| 0     | 0%                  | 기본 Surface                |
| 1     | 5%                  | Elevated Card, Bottom Sheet |
| 2     | 8%                  | Navigation Bar, Menu        |
| 3     | 11%                 | FAB, Dialog                 |
| 4     | 12%                 | (호버 상태 elevation)        |
| 5     | 14%                 | 최상위 오버레이              |

---

# 5-1. State Layers (상태 레이어)

M3는 인터랙션 상태를 색상 오버레이(State Layer)로 표현한다. 그림자나 색상 교체 대신 **on-color를 지정된 불투명도로 덮어씌운다.**

## 상태별 불투명도

| State    | Opacity | 발생 시점                    |
| -------- | ------- | ---------------------------- |
| Hover    | 8%      | 마우스 커서가 올라갈 때       |
| Focused  | 10%     | 키보드 포커스 진입 시         |
| Pressed  | 10%     | 클릭·탭 순간                  |
| Dragged  | 16%     | 드래그 중 (elevation도 상승)  |

## 규칙

* 동시에 하나의 상태 레이어만 적용한다 (Hover + Focus 중첩 없음).
* 상태 레이어 색상 = 해당 컴포넌트의 **on-color** (예: Primary 버튼 → on-primary).
* 터치 영역(48dp)과 시각적 상태 레이어 영역(40dp)은 분리된다.

## CSS 구현 예시

```css
/* Filled Button — Hover state layer */
.btn-filled:hover::before {
  content: '';
  position: absolute;
  inset: 0;
  background-color: var(--md-sys-color-on-primary);
  opacity: 0.08;
  border-radius: inherit;
}

/* Focus state */
.btn-filled:focus-visible::before {
  opacity: 0.10;
}

/* Pressed state */
.btn-filled:active::before {
  opacity: 0.10;
}
```

---

# 6. Buttons

## Filled Button

```css
height: 40px;
border-radius: 9999px; /* 'full' 토큰 = height ÷ 2 (기본 40dp에서 20dp). 고정 20px 아님 — pill 형태 */
```

주요 액션 (M3는 버튼을 fully-rounded 'full' 코너로 정의한다. 출처: https://m3.material.io/components/buttons/overview)

---

## Outlined Button

```css
border: 1px solid;
```

보조 액션

---

## Text Button

```css
background: none;
```

저우선순위 액션

---

## Rules

* 한 화면에 Primary CTA 1개
* 버튼 상태 표시 필수
* Hover / Focus 지원

---

# 6-1. FAB (Floating Action Button)

화면에서 가장 중요한 단일 액션을 위한 컴포넌트. 모든 콘텐츠 위에 떠 있는 형태로 표시된다.

## 크기

| Variant    | Container Size | Icon Size | Border Radius |
| ---------- | -------------- | --------- | ------------- |
| Small      | 40 × 40dp      | 24dp      | 12dp          |
| FAB (기본) | 56 × 56dp      | 24dp      | 16dp          |
| Large      | 96 × 96dp      | 36dp      | 28dp          |

※ 2025 M3 업데이트 기준 별도의 'Medium FAB'는 80×80dp이며, Small FAB(40dp)는 deprecated다. 출처: https://m3.material.io/components/floating-action-button/specs

## CSS 예시 (Medium FAB)

```css
.fab {
  width: 56px;
  height: 56px;
  border-radius: 16px;
  background-color: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 3px 5px rgba(0,0,0,.2), 0 1px 18px rgba(0,0,0,.12);
  /* Elevation Level 3 */
}
```

## 사용 규칙

* 화면당 FAB 1개 원칙 (가장 핵심 액션에만 사용).
* 위치: 우측 하단 (모바일), 콘텐츠 위에 오버레이.
* 스크롤 시 숨기거나 축소(Extended → Icon) 가능.
* FAB는 삭제·파괴적 액션에 사용하지 않는다.

---

# 7. Cards

## Standard Card

```css
border-radius: 12px;
padding: 16px;
```

---

## Rules

* 콘텐츠 그룹화 목적
* 카드 안에 카드 중첩 최소화

---

# 8. Navigation

## Top App Bar

```css
64px
```

---

## Navigation Rail

```css
80px
```

태블릿 이상 권장

---

## Navigation Drawer

```css
360px
```

대규모 메뉴

---

## Bottom Navigation

```css
80px
```

모바일 권장

---

# 9. Forms

## Text Field

```css
height: 56px;
border-radius: 4px;
```

---

## States

* Enabled
* Focused
* Disabled
* Error

모든 상태 정의 필수

---

## Validation

* 즉각적 피드백 제공
* 오류 해결 방법 표시

---

# 10. Motion

## Duration

| Type       | Time       |
| ---------- | ---------- |
| Short      | 50~200ms   |
| Medium     | 250~400ms  |
| Long       | 450~600ms  |
| Extra-Long | 700~1000ms |

> M3 공식 duration 토큰 기준. 출처: https://m3.material.io/styles/motion/easing-and-duration/tokens-specs
> (구 출처 `material-foundation/material-tokens` 리포지토리는 2024-10 아카이브되어 해당 경로가 404다.)

---

## Easing Curves

M3는 4가지 이징 커브를 정의한다.

| Curve    | cubic-bezier              | 사용 상황                  |
| -------- | ------------------------- | -------------------------- |
| Standard | `cubic-bezier(0.2,0,0,1)` | 기본 UI 전환 (대부분의 경우) |
| Emphasized | M3 공식 2-part path 곡선 — CSS 단일 `cubic-bezier()`로 표현 불가. 구현 시 Emphasized Decelerate `cubic-bezier(0.05,0.7,0.1,1)`(진입) / Emphasized Accelerate `cubic-bezier(0.3,0,0.8,0.15)`(퇴장) 분리 토큰 사용 | 화면 진입·주요 전환 |
| Standard Decelerate | `cubic-bezier(0,0,0,1)` | 요소 진입 (빠르게 시작 → 천천히 정지) |
| Standard Accelerate | `cubic-bezier(0.3,0,1,1)` | 요소 퇴장 (천천히 시작 → 빠르게 퇴장) |

```css
/* Standard — 일반 전환 */
transition-timing-function: cubic-bezier(0.2, 0, 0, 1);

/* Decelerate — 요소 등장 */
transition-timing-function: cubic-bezier(0, 0, 0, 1);

/* Accelerate — 요소 퇴장 */
transition-timing-function: cubic-bezier(0.3, 0, 1, 1);
```

---

## Rules

* 상태 변화를 설명
* 위치 이동을 이해 가능하게
* 과도한 효과 금지

---

# 11. Shapes

## Radius

| Type        | Value |
| ----------- | ----- |
| Extra Small | 4px   |
| Small       | 8px   |
| Medium      | 12px  |
| Large       | 16px  |
| Extra Large | 28px  |

> 위 5단계는 유효하지만 완전한 목록은 아니다. M3는 0dp(직각)부터 Full(완전 원형)까지 세분화된 **10단계 corner radius 스케일**을 제공한다. 출처: https://m3.material.io/styles/shape/corner-radius-scale

---

# 12. Icons

## Material Symbols

기본 크기

```css
20px
24px
```

---

## Rules

* 텍스트 보조 역할
* 의미 명확성 우선

---

# 13. Accessibility

## Touch Target

최소 48 × 48dp (Material 규격 단위는 dp; 웹 CSS 구현 시 48px에 대응).

---

## Contrast

```text
WCAG AA 이상
```

---

## Keyboard

* 모든 기능 접근 가능
* Focus 상태 표시

---

# 14. Dark Mode

## Surface

```css
#141218
```

---

## Surface Container

```css
#211F26
```

---

## Rules

* 순수 검정보다 Surface 계층 사용
* 명도 차이로 구조 표현

---

# 15. Developer Checklist

## Layout

* [ ] 8dp Grid 사용 (4dp는 아이콘·타이포용 보조 그리드)
* [ ] 반응형 대응
* [ ] Breakpoint 적용

## Typography

* [ ] Material Type Scale 사용
* [ ] 일관된 계층 구조 유지

## Components

* [ ] Hover 지원 (State Layer 8%)
* [ ] Focus 지원 (State Layer 10%)
* [ ] Pressed 지원 (State Layer 10%)
* [ ] Disabled 상태 제공
* [ ] FAB — 화면당 1개, 핵심 액션만

## Motion

* [ ] Easing curve 적용 (Standard / Decelerate / Accelerate)
* [ ] 요소 등장 시 Decelerate easing 사용
* [ ] 요소 퇴장 시 Accelerate easing 사용

## Elevation

* [ ] Tonal surface-container 역할 사용 (surfaceTint 오버레이는 deprecated — 그림자만으로 고도 표현하지 않음)
* [ ] 다크모드에서 shadow 활용

## Accessibility

* [ ] Touch Target 48dp
* [ ] Keyboard 접근 가능
* [ ] 스크린 리더 지원

## Performance

* [ ] 이미지 최적화
* [ ] Skeleton UI 제공
* [ ] Lazy Loading 적용
* [ ] 애니메이션 60fps 유지

---

## 비공식 (공식 문서 미수록 · 관행·추정값)

아래 항목은 공식 Material Design 3 문서에서 확인되지 않은 비공식 컨벤션이다.

### §2 Layout — 간격 레이블 (XS/S/M/L/XL/XXL) — 비공식

M3 공식 토큰명은 space50/space100 등 숫자형이며 XS/S/M/L/XL/XXL 레이블은 비공식이다. dp 값 자체(4/8/16/24/32/48)는 8dp 배수 기준으로 유효하다.

| Size | Value |
| ---- | ----- |
| XS   | 4dp   |
| S    | 8dp   |
| M    | 16dp  |
| L    | 24dp  |
| XL   | 32dp  |
| XXL  | 48dp  |

---

## 출처

확인일 2026-06-29(1차), 2026-07-03(2차 재검증). (본문의 일부 px 표기는 공식 dp 규격을 CSS 단위로 옮긴 값이다.)

- 핵심 원칙(Personal/Adaptive/Expressive): https://m3.material.io/foundations/overview/principles
- 최소 터치 영역 48dp (iOS 44 예외 명시): https://m3.material.io/foundations/designing/structure
- 스페이싱(8dp/4dp): https://m3.material.io/styles/spacing/overview
- Type scale + Emphasized: https://m3.material.io/styles/typography/type-scale-tokens
- Shape 10단계 스케일: https://m3.material.io/styles/shape/corner-radius-scale
- State Layers(Hover 8/Focus·Pressed 10/Dragged 16%): https://m3.material.io/foundations/interaction/states/state-layers
- Tone-based surface color (surfaceTint 폐기): https://m3.material.io/blog/tone-based-surface-color-m3
- Buttons(full 코너/40dp): https://m3.material.io/components/buttons/overview
- Motion easing/duration 토큰: https://m3.material.io/styles/motion/easing-and-duration/tokens-specs
- Window size class(breakpoint): https://developer.android.com/develop/ui/compose/layouts/adaptive/use-window-size-classes
- FAB specs (2025): https://m3.material.io/components/floating-action-button/specs
- M3 Expressive(2025 업데이트 웨이브): https://m3.material.io/blog/building-with-m3-expressive

> **검증 방식 주의:** `m3.material.io/*` 페이지는 JS 렌더링(SPA)이라 정적 fetch로 본문을 읽지 못한다. Window size class(Android 문서)·State Layers·48dp·FAB·원칙·surfaceTint 폐기 등은 공식 도메인 검색 색인/정적 페이지로 교차 확인했다. 다만 아래 값들은 이번 재검증에서 **라이브 공식 페이지 본문으로 직접 확인하지 못한 항목**이다(위젯 실측·미러링 값으로 널리 통용되나 엄밀 미확인): 네비게이션 높이(Top App Bar 64 / Nav Rail 80 / Drawer 360 / Bottom Nav 80), Text Field 56/4, baseline 컬러 hex, 다크모드 surface hex, Standard Decelerate/Accelerate·Emphasized 이징 세부 곡선. JS 렌더 가능한 브라우저로 후속 확인 권장.
