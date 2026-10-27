-- 스키마 덤프 조회 — shl/schema-dump.sh 가 이 파일을 그대로 sqlplus 에 넘긴다.
--
-- 팀이 함께 쓰는 파일이라 커밋한다. 사람마다 SELECT 가 다르면 같은 DB 를 떠도 날짜끼리 견줄 때
-- 없는 변경이 생긴다.
--
-- 고쳐도 되는 것: 조건 · 정렬 · 뺄 테이블. 지켜야 하는 것 — 화면(src/lib/schemaParse.ts)이 읽는 형식:
--   1. 종류마다 PROMPT 로 헤더 한 줄을 먼저 낸다.  [COLUMN],TABLE_NAME,...
--      필드 순서는 이 헤더에서 읽으므로 SELECT 목록을 바꾸면 헤더도 같이 바꾼다.
--   2. 데이터 줄은 '[종류],' 로 시작하고 쉼표로 가른다. 종류는 COLUMN · CONSTRAINT · INDEX 셋뿐이다.
--
-- 스크립트가 앞에 붙이는 것 (여기 다시 적지 않는다):
--   SET PAGESIZE 0 · HEADING OFF · FEEDBACK OFF · LINESIZE 32767 · TRIMOUT ON, 오류면 종료, 접속.
--   SET SQLBLANKLINES ON — 문장 중간에 빈 줄이 있어도 된다. 대신 문장은 반드시 ; 로 끝낸다.
--   DEFINE owner = 소유자 — change/schema-dump.env 의 DB_OWNER, 비었으면 접속 계정.
--
-- 치환 변수는 owner 하나만 쓴다. 다른 이름을 쓰면 sqlplus 가 값을 물으며 다음 줄을 값으로 삼켜
-- 버리므로, 스크립트가 실행 전에 막는다.
--
-- BIN$ 은 휴지통에 들어간 테이블이라 뺀다.
-- 정렬을 고정해야 날짜끼리 견줄 때 줄 순서가 흔들리지 않는다.

PROMPT [COLUMN],TABLE_NAME,COLUMN_NAME,DATA_TYPE,DATA_LENGTH,DATA_PRECISION,DATA_SCALE,NULLABLE
SELECT '[COLUMN],' || c.TABLE_NAME || ',' || c.COLUMN_NAME || ',' || c.DATA_TYPE || ',' ||
       c.DATA_LENGTH || ',' || c.DATA_PRECISION || ',' || c.DATA_SCALE || ',' || c.NULLABLE
  FROM ALL_TAB_COLUMNS c
  JOIN ALL_TABLES t ON t.OWNER = c.OWNER AND t.TABLE_NAME = c.TABLE_NAME
 WHERE c.OWNER = '&owner'
   AND c.TABLE_NAME NOT LIKE 'BIN$%'
 ORDER BY c.TABLE_NAME, c.COLUMN_ID;

PROMPT
PROMPT [CONSTRAINT],TABLE_NAME,CONSTRAINT_NAME,CONSTRAINT_TYPE,COLUMN_NAME,POSITION
SELECT '[CONSTRAINT],' || c.TABLE_NAME || ',' || c.CONSTRAINT_NAME || ',' || c.CONSTRAINT_TYPE || ',' ||
       cc.COLUMN_NAME || ',' || cc.POSITION
  FROM ALL_CONSTRAINTS c
  JOIN ALL_CONS_COLUMNS cc ON cc.OWNER = c.OWNER AND cc.CONSTRAINT_NAME = c.CONSTRAINT_NAME
 WHERE c.OWNER = '&owner'
   AND c.CONSTRAINT_TYPE IN ('P', 'U', 'R', 'C')
   AND c.TABLE_NAME NOT LIKE 'BIN$%'
 ORDER BY c.TABLE_NAME, c.CONSTRAINT_NAME, cc.POSITION, cc.COLUMN_NAME;

PROMPT
PROMPT [INDEX],TABLE_NAME,INDEX_NAME,UNIQUENESS,COLUMN_NAME,COLUMN_POSITION
SELECT '[INDEX],' || i.TABLE_NAME || ',' || i.INDEX_NAME || ',' || i.UNIQUENESS || ',' ||
       ic.COLUMN_NAME || ',' || ic.COLUMN_POSITION
  FROM ALL_INDEXES i
  JOIN ALL_IND_COLUMNS ic ON ic.INDEX_OWNER = i.OWNER AND ic.INDEX_NAME = i.INDEX_NAME
 WHERE i.TABLE_OWNER = '&owner'
   AND i.TABLE_NAME NOT LIKE 'BIN$%'
 ORDER BY i.TABLE_NAME, i.INDEX_NAME, ic.COLUMN_POSITION;
