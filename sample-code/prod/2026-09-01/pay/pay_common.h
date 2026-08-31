#ifndef _PAY_COMMON_H_
#define _PAY_COMMON_H_

#define RC_OK                0
#define ERR_DB             -10
#define ERR_PAY_AMT        -31
#define ERR_NO_PAY         -32
#define ERR_NOT_CANCELABLE -33
#define ERR_DAY_LIMIT      -34

#define MAX_PAY_AMT      50000000
#define MAX_DAY_PAY_AMT 200000000

typedef struct {
    char   acct_no[12];
    double pay_amt;
} PAY_REQ;

typedef struct {
    char pay_no[11];
} PAY_CANCEL_REQ;

typedef struct {
    int  rc;
    char pay_no[11];
} PAY_RES;

#endif
