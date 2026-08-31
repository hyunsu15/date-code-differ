/******************************************************************
 * 파 일 명 : ord_common.h
 * 기    능 : 주문 모듈 공통 상수/구조체
 ******************************************************************/
#ifndef _ORD_COMMON_H_
#define _ORD_COMMON_H_

#define RC_OK                 0
#define ERR_DB              -10
#define ERR_QTY_RANGE       -21
#define ERR_PRC_RANGE       -22
#define ERR_NO_ACCT         -23
#define ERR_NO_BALANCE      -24
#define ERR_NO_ORD          -25
#define ERR_NOT_CANCELABLE  -26
#define ERR_QTY_UNIT        -27

#define MAX_ORD_QTY     1000000
#define ORD_QTY_UNIT          1

typedef struct {
    char   acct_no[12];
    char   isin_cd[13];
    char   ord_tp[2];
    long   ord_qty;
    double ord_prc;
} ORD_REQ;

typedef struct {
    char ord_no[11];
    char acct_no[12];
} ORD_CANCEL_REQ;

typedef struct {
    char   ord_no[11];
    char   acct_no[12];
    long   ord_qty;
    double ord_prc;
} ORD_AMEND_REQ;

typedef struct {
    int  rc;
    char ord_no[11];
} ORD_RES;

#endif
