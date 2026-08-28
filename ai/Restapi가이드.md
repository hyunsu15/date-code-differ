# REST API URL 설계 규칙

## 1. 기본 원칙

* URL은 **리소스(Resource, 자원)** 중심으로 설계한다.
* URL에는 동사보다 명사를 사용한다.
* 행위(Create, Read, Update, Delete)는 HTTP Method로 표현한다.
* URL 규칙은 프로젝트 전체에서 일관성을 유지한다.

---

# 2. 기본 URL 구조

```text
/resources
/resources/{id}
/resources/{id}/sub-resources
```

예시:

```text
/users
/users/1
/users/1/orders
/orders/100
```

---

# 3. HTTP Method 사용 규칙

| 기능    | Method | URL           |
| ----- | ------ | ------------- |
| 목록 조회 | GET    | `/users`      |
| 단건 조회 | GET    | `/users/{id}` |
| 생성    | POST   | `/users`      |
| 전체 수정 | PUT    | `/users/{id}` |
| 부분 수정 | PATCH  | `/users/{id}` |
| 삭제    | DELETE | `/users/{id}` |

- PUT은 멱등(idempotent)하며 리소스를 **전체 치환**한다. 보내지 않은 필드는 초기화될 수 있다.
- PATCH는 **부분 변경**이며 기본적으로 멱등성이 보장되지 않는다. (멱등하게 구현하려면 `If-Match` + `ETag` 등 조건부 요청을 활용한다.)

---

# 3-1. 응답 상태 코드

| 상황 | 상태 코드 |
| ---- | -------- |
| 조회 성공 | 200 OK |
| 생성 성공 | 201 Created (+ `Location` 헤더 권장) |
| 성공했으나 응답 본문 없음 (삭제 등) | 204 No Content |
| 잘못된 요청 (형식 오류·필수 파라미터 누락 등) | 400 Bad Request |
| 인증 필요 / 실패 | 401 Unauthorized |
| 권한 없음 | 403 Forbidden |
| 리소스 없음 | 404 Not Found |
| 상태 충돌 (중복 등) | 409 Conflict |
| 구문은 맞지만 의미상 처리 불가 (비즈니스 검증 실패 등) | 422 Unprocessable Content |
| 요청 횟수 초과 (Rate Limiting) | 429 Too Many Requests |
| 서버 오류 | 500 Internal Server Error |


> 새 리소스는 요청 URL 또는 `Location` 헤더로 찾을 수 있어야 한다 (둘 중 하나면 됨; POST 생성 시 `Location` 권장).

---

# 4. URL 네이밍 규칙

## 4-1. 복수형 사용

```text
/users
/orders
/products
```

권장:

* 복수형 리소스명 사용

비권장:

```text
/user
/order
```

---

## 4-2. 동사 사용 금지

비권장:

```text
/getUsers
/createOrder
/deleteTask
```

권장:

```text
GET /users
POST /orders
DELETE /tasks/{id}
```

---

## 4-3. kebab-case 사용

권장:

```text
/task-cases
/scenario-runs
/order-items
```

비권장:

```text
/task_cases
/scenarioRuns
```

---

# 5. 계층 구조 표현

리소스 간 소속 관계가 있으면 URL 계층으로 표현한다.

예시:

```text
/users/{userId}/orders
/projects/{projectId}/tasks
/tasks/{taskId}/comments
```

---

# 6. 검색/필터/정렬은 Query Parameter 사용

## 검색

```text
/users?name=kim
```

## 페이징

```text
/users?page=1&size=20
```

## 정렬

```text
/products?sort=price
```

## 복합 조건

```text
/orders?status=READY&page=2&size=50
```

---

# 7. 액션성 API 처리

REST만으로 표현이 어려운 경우 예외적으로 액션 사용 가능.

예시:

```text
POST /orders/{id}/cancel
POST /payments/{id}/refund
POST /scenarios/{id}/execute
```

---

# 8. 응답 구조 권장 예시

## 목록 조회

```json
{
  "items": [],
  "page": 1,
  "size": 20,
  "totalCount": 100,
  "totalPages": 5,
  "hasNext": true
}
```

> `Link` 헤더(prev/next)도 함께 제공할 수 있다.

## 단건 조회

```json
{
  "id": 1,
  "name": "Task A"
}
```

---

# 9. API 버저닝

URL 경로 버저닝(`/v1/`, `/v2/`)을 기본으로 사용한다. 하위 호환이 깨지는 변경은 새 버전 경로를 도입하고, 구버전은 유예기간을 두고 폐기(deprecation)한다. (헤더 기반 버저닝은 캐싱·디버깅이 어려워 보조 수단으로만 활용한다.)

예시:

```text
GET /v1/users
GET /v2/users
```

---

# 10. 최종 권장 사항

* URL은 명사 중심으로 설계
* HTTP Method로 행위 표현
* URL 규칙 통일
* Query Parameter로 검색/필터 처리
* 계층 관계는 URL depth로 표현
* Action API는 최소한으로 사용
* 직관성과 예측 가능성을 우선시한다.
* GET 리소스에는 `Cache-Control`·`ETag`를 활용해 불필요한 재전송을 줄인다 (조건부 요청 시 304 Not Modified). 세부 전략은 성능 가이드를 따른다.
