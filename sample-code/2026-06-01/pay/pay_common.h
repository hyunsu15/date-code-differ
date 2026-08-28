#ifndef _PAY_COMMON_H_
#define _PAY_COMMON_H_

#define RC_OK                0
#define ERR_DB             -10
#define ERR_PAY_AMT        -31
#define ERR_NO_PAY         -32
#define ERR_NOT_CANCELABLE -33

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
