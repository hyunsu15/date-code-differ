/******************************************************************
 * 파 일 명 : rpt_common.h
 * 기    능 : 리포트 모듈 공통 상수/구조체
 ******************************************************************/
#ifndef _RPT_COMMON_H_
#define _RPT_COMMON_H_

#define RC_OK           0
#define ERR_DB        -10
#define ERR_NO_DATA   -41
#define ERR_BAD_PERIOD -42

#define MAX_ROWS    10000

typedef struct {
    char base_dt[9];
    char acct_no[12];
} RPT_REQ;

typedef struct {
    int  rc;
    long row_count;
} RPT_RES;

#endif
