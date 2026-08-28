# Apple Style UI Guide

## 1. Design Principles

### Clarity

* 콘텐츠가 가장 중요하다.
* UI는 콘텐츠를 방해하지 않는다.
* 텍스트는 읽기 쉬워야 한다.
* 아이콘은 의미를 명확하게 전달해야 한다.

### Deference

* UI는 사용자 경험을 돕는 역할만 한다.
* 과도한 장식 요소를 사용하지 않는다.
* 콘텐츠를 중심으로 배치한다.

### Depth

* 계층 구조를 명확하게 표현한다.
* 적절한 그림자와 애니메이션을 사용한다.
* 사용자의 위치와 이동 경로를 이해할 수 있게 한다.

---

## 2. Layout

### Grid System

* 기본 여백 단위: 8px 배수 권장. (⚠️ Apple HIG는 고정된 "8pt 스페이싱 그리드"를 공식 문서로 공표하지 않는다 — 이는 일반적인 디자인 시스템 관행이다. 세부 수치는 하단 **비공식** 섹션 참고.) CSS에서는 px로 구현한다. CSS의 `pt`는 1.333px 인쇄 단위이므로 사용하지 않는다.

### Safe Area

* 화면 가장자리에 요소를 붙이지 않는다.

---

## 3. Typography

### Font

우선순위

```text
SF Pro Display
SF Pro Text
system-ui
sans-serif
```

### Text Styles (Dynamic Type)

Apple은 임의의 H1~H4가 아니라 **의미 기반 텍스트 스타일**을 정의한다. 아래는 각 스타일의 기본(Large, 사용자 기본 설정) 크기다. 단위는 **pt**이며, 사용자의 Dynamic Type 설정에 따라 크기가 자동으로 확대·축소된다. CSS로 옮길 때 1pt를 1px로 근사한다(정확히 동일하지는 않다).

| Text Style   | 기본 크기 | Weight   |
| ------------ | --------- | -------- |
| Large Title  | 34pt      | Regular  |
| Title 1      | 28pt      | Regular  |
| Title 2      | 22pt      | Regular  |
| Title 3      | 20pt      | Regular  |
| Headline     | 17pt      | Semibold |
| Body         | 17pt      | Regular  |
| Callout      | 16pt      | Regular  |
| Subheadline  | 15pt      | Regular  |
| Footnote     | 13pt      | Regular  |
| Caption 1    | 12pt      | Regular  |
| Caption 2    | 11pt      | Regular  |

출처: `UIFont.TextStyle` — https://developer.apple.com/documentation/uikit/uifont/textstyle · Typography HIG — https://developer.apple.com/design/human-interface-guidelines/typography

### Rules

* 고정 px 대신 위 텍스트 스타일(Dynamic Type)에 대응시켜 접근성 글자 크기를 지원한다.
* 불필요한 Bold 남용 금지

---

## 4. Colors

Apple HIG의 핵심 원칙은 **고정 hex가 아니라 시맨틱(semantic) 시스템 컬러를 사용**하는 것이다. 시스템 컬러는 Light/Dark 모드, 명암 증가(Increase Contrast) 설정, OS 버전에 따라 실제 렌더링 값이 자동으로 바뀐다. 따라서 특정 hex를 스펙으로 고정하지 않는다.

출처: Color HIG — https://developer.apple.com/design/human-interface-guidelines/color

### 역할별 시스템 컬러 (시맨틱)

| 역할     | 시스템 컬러      |
| -------- | ---------------- |
| Primary  | `systemBlue`     |
| Success  | `systemGreen`    |
| Warning  | `systemOrange`   |
| Error    | `systemRed`      |
| Gray     | `systemGray`~`systemGray6` |

> 참고용 실측 hex 값은 하단 **비공식** 섹션 참고.

### Rules

* 시맨틱 시스템 컬러 사용 — Light/Dark에 자동 적응한다.
* 의미 없는 색상 사용 금지
* 상태 표현에만 강조 색상 사용
* 다크모드 지원 필수

---

## 5. Buttons

### Rules

* 최소 터치 영역 44×44pt (CSS 44px)
* 버튼 개수 최소화
* 주요 액션은 화면당 1개

---

## 6. Cards

### Rules

* 카드 중첩 최소화
* 필요할 때만 그림자 사용

---

## 7. Navigation

### Navigation Bar

```css
height: 44px;
```

구성

* Back
* Title
* Action

### Rules

* 현재 위치가 명확해야 함
* 한 화면에 주요 액션 1개

---

## 8. Lists

### Rules

* 시각적 구분선 최소화
* 여백으로 구분
* 스캔하기 쉽게 구성

---

## 9. Forms

### Rules

* 필수 입력 최소화
* 실시간 검증 제공
* 오류 메시지는 입력창 아래 표시

---

## 10. Animations

### Easing

```css
/* 참고: 아래 값은 CSS 표준 ease-in-out과 동일하며 Apple 고유 공식값이 아니다 */
cubic-bezier(0.42, 0, 0.58, 1)
```

- Apple UIKit의 `.easeInEaseOut`은 위 CSS `ease-in-out`과 수치상 동일하지만, iOS 시스템 UI 애니메이션(시트·화면 전환 등)은 spring 기반(`UISpringTimingParameters`)이라 고정 cubic-bezier로 정확히 재현되지 않는다. 가능하면 spring 애니메이션을 우선한다.
- `cubic-bezier(0.4, 0, 0.2, 1)`은 Material Design **2**의 standard easing이다. (Material **3**의 standard는 `cubic-bezier(0.2, 0, 0, 1)`) — Apple 가이드에서는 사용하지 않는다.

### Rules

* 기능 설명용 애니메이션 금지
* 상태 변화만 표현
* 빠르고 자연스럽게

---

## 11. Icons

* SF Symbols 사용 권장
* 텍스트 없이 의미 전달 가능해야 함

---

## 12. Accessibility

### Contrast

* 최소 WCAG AA 준수

### Touch Target

```css
44×44pt 이상 (CSS에서는 44px)
```

### Support

* VoiceOver
* Dynamic Type
* Keyboard Navigation

---

## 13. Dark Mode

### Rules

* 색상은 `UIColor.systemBackground` 등 semantic color 사용 (Light/Dark 자동 적응). 다크모드 `systemBackground`는 순수 검정 `#000000`이다. 출처: https://developer.apple.com/documentation/uikit/uicolor/systembackground
* 계층에 따라 명도 차이 제공 — `secondarySystemBackground`/`tertiarySystemBackground` 등 상위 시맨틱 컬러 사용.

예시

```css
Background: #000000   /* systemBackground (다크) — 공식 */
Surface: #1C1C1E          /* secondarySystemBackground 실측값 — 비공식 (Apple 미공표) */
Secondary Surface: #2C2C2E /* tertiarySystemBackground 실측값 — 비공식 (Apple 미공표) */
```

---

## 14. Tab Bar

### Specs

```css
height: 49px; /* de-facto 표준값 — Apple 공식 문서에 명시된 수치는 아님. 하단 비공식 참고 */
padding-bottom: env(safe-area-inset-bottom); /* 홈 인디케이터 영역 확보 */
```

* 아이콘: 25×25px (비공식 관행값)
* **항목 수: 최대 5개 (iPhone 기준)** — 공식. 6개 이상 추가 시 `UITabBarController`가 자동으로 "More" 탭을 삽입한다. 출처: https://developer.apple.com/documentation/uikit/uitabbarcontroller

### Rules

* 탭은 앱의 최상위 구조 전환에만 사용
* 탭 전환 시 각 탭의 스크롤 위치·상태 유지
* 현재 탭 아이콘은 Primary Color(`#007AFF`)로 강조
* 탭 내부 이동에는 Navigation Bar 사용

---

## 15. Bottom Sheet (Sheet Presentation)

### Detent (높이 단계)

| Detent  | 높이         | 용도                  |
| ------- | ------------ | --------------------- |
| Small   | ~25% vh      | 간단한 옵션, 확인 (Apple 공식 detent 아님 — iOS 16+ `.custom(...)`으로 구현) |
| Medium  | ~50% vh      | 보조 정보, 필터 (`.medium()`, iOS 15+) |
| Large   | ~92% vh      | 전체 콘텐츠 (`.large()`, iOS 15+, 사실상 전체화면) |

### Rules

* 핸들을 항상 상단에 표시 (드래그 가능함을 암시)
* 아래로 스와이프하면 dismiss
* 시트 내부 스크롤이 최상단일 때만 dismiss 제스처 활성화

---

## 16. Safe Area (CSS 환경 변수)

PWA 또는 iOS Safari 전체화면에서 노치·홈 인디케이터와 겹치지 않도록 필수 적용.

### viewport-fit 설정

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
```

### CSS 적용

```css
/* 상단 노치 영역 (Status Bar) */
padding-top: env(safe-area-inset-top);

/* 하단 홈 인디케이터 영역 */
padding-bottom: env(safe-area-inset-bottom);

/* 좌우 (Dynamic Island 등) */
padding-left: env(safe-area-inset-left);
padding-right: env(safe-area-inset-right);
```

### 주요 적용 대상

| 컴포넌트       | 적용 속성                          |
| -------------- | ---------------------------------- |
| Navigation Bar | `padding-top`                      |
| Tab Bar        | `padding-bottom`                   |
| Bottom Sheet   | `padding-bottom`                   |
| 고정 하단 버튼 | `padding-bottom` 또는 `margin-bottom` |

### Rules

* `viewport-fit=cover` 없이 `env()` 값은 항상 0
* Fallback 값 필수: `env(safe-area-inset-bottom, 16px)`
* Pure Black 배경에서 Status Bar와 구분되도록 색상 주의

---

## 17. Developer Checklist

### Layout

* [ ] 8pt Grid 사용
* [ ] Safe Area 확보
* [ ] Responsive 대응

### Typography

* [ ] 최대 4단계 Heading
* [ ] 읽기 쉬운 행간

### Components

* [ ] 최소 터치 영역 44px
* [ ] 일관된 Radius 사용

### Accessibility

* [ ] 키보드 조작 가능
* [ ] 스크린 리더 지원
* [ ] 명암비 검증 완료

### Tab Bar & Sheet

* [ ] Tab Bar에 `env(safe-area-inset-bottom)` 적용
* [ ] Bottom Sheet handle 표시
* [ ] Sheet border-radius 12px (상단)

### Safe Area

* [ ] `viewport-fit=cover` meta 태그 설정
* [ ] Navigation Bar에 `env(safe-area-inset-top)` 적용
* [ ] 하단 고정 요소에 `env(safe-area-inset-bottom)` 적용

### Performance

* [ ] 60fps 애니메이션
* [ ] 불필요한 렌더링 제거
* [ ] 이미지 최적화
* [ ] Lazy Loading 적용

---

## 비공식 (공식 문서 미수록 · 관행·추정값)

아래 항목은 공식 Apple HIG·developer.apple.com 문서에서 확인되지 않은 일반 관행값·추정값이다. 공식 출처가 확인되면 위 본문으로 옮긴다.

### Colors — 비공식 (커뮤니티 실측값)

Apple은 시스템 컬러의 hex 값을 공식 스펙으로 공표하지 않는다. 아래는 커뮤니티에서 실측된 참고값이며 Light 모드 기준이다. OS 버전·다크모드·명암 설정에 따라 달라진다(예: 다크모드 `systemBlue`는 실측 `#0A84FF`).

```css
systemBlue:   #007AFF
systemGreen:  #34C759
systemOrange: #FF9500
systemRed:    #FF3B30
```

#### Gray Scale (실측 참고값)

```css
#F2F2F7
#E5E5EA
#D1D1D6
#8E8E93
#3A3A3C
#1C1C1E
```

#### Dark Mode Surface (실측 참고값)

```css
secondarySystemBackground: #1C1C1E
tertiarySystemBackground:  #2C2C2E
```

### Layout — 비공식

#### Container

```css
max-width: 1200px;
padding: 24px;
margin: 0 auto;
```

#### Grid System 컴포넌트 간격

* Small: 8px
* Medium: 16px
* Large: 24px
* Extra Large: 32px

#### Safe Area 최소 여백

* 최소 16px 이상의 여백을 유지한다.

### Typography — 비공식

* 줄 길이 60~80자 권장
* 행간 1.4~1.6

### Buttons — 비공식

#### Primary Button

```css
height: 44px;
padding: 0 16px;
border-radius: 12px;
```

#### Secondary Button

```css
background: transparent;
border: none;
```

### Cards — 비공식

```css
border-radius: 16px;
padding: 16px;
background: white;
```

#### Shadow

```css
box-shadow:
0 2px 8px rgba(0,0,0,0.08);
```

### Lists — 비공식

#### Item Height

```css
44px ~ 56px
```

### Forms — 비공식

#### Input

```css
height: 44px;
border-radius: 10px;
padding: 0 12px;
```

### Animations — 비공식

#### Duration

| Type   | Duration |
| ------ | -------- |
| Fast   | 150ms    |
| Normal | 250ms    |
| Slow   | 350ms    |

### Icons — 비공식

* 20~24px 기준

### Tab Bar — 비공식

#### Item

```css
min-width: 44px;
padding: 4px 0;
```

* 레이블: 10px (Caption보다 작게)

### Bottom Sheet — 비공식

#### Container

```css
border-radius: 12px 12px 0 0;
padding-top: 8px;
padding-bottom: env(safe-area-inset-bottom);
```

#### Handle (드래그 핸들)

```css
width: 36px;
height: 5px;
border-radius: 3px;
background: #3A3A3C;
margin: 0 auto 8px;
```

* 배경 dimming: `rgba(0, 0, 0, 0.4)`

---

## 출처

확인일 2026-06-29(1차), 2026-07-03(2차 재검증). (아래 출처에 없는 세부 수치 — 폰트·아이콘·레이블 px 등 — 은 추정·관행값이다.)

- 최소 터치 영역(44×44pt): https://developer.apple.com/design/tips/ ("Create controls that measure at least 44 points x 44 points")
- 텍스트 스타일/Dynamic Type: https://developer.apple.com/documentation/uikit/uifont/textstyle · https://developer.apple.com/design/human-interface-guidelines/typography
- 시맨틱 컬러(고정 hex 미공표): https://developer.apple.com/design/human-interface-guidelines/color
- Tab Bar 5개 초과 시 More 탭: https://developer.apple.com/documentation/uikit/uitabbarcontroller
- Sheet detent(.medium/.large, iOS15+): https://developer.apple.com/documentation/uikit/uisheetpresentationcontroller/detent · https://developer.apple.com/videos/play/wwdc2021/10063/ · https://developer.apple.com/videos/play/wwdc2022/10068/
- 애니메이션(spring 기반): https://developer.apple.com/videos/play/wwdc2023/10158/
- Dark Mode `systemBackground`: https://developer.apple.com/documentation/uikit/uicolor/systembackground

> ⚠️ **신선도 주의:** 2025 WWDC에서 Apple은 새 디자인 시스템("Liquid Glass")을 발표했다(https://developer.apple.com/videos/play/wwdc2025/356/). 컬러·탭바·컴포넌트 외형 수치가 이후 변경되었을 수 있으므로, 최신 값은 개편된 HIG로 재확인한다.
>
> 검증 방식 주의: `developer.apple.com/design/human-interface-guidelines/*` 페이지는 JS 렌더링(SPA)이라 정적 fetch로 본문 확인이 어렵다. 위 수치 중 일부는 공식 도메인 검색 색인·API 레퍼런스 페이지로 교차 확인했다.
