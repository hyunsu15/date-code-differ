CREATE OR REPLACE PACKAGE BODY PKG_PAY_PG AS

    FUNCTION request_approval(
        p_acct_no IN VARCHAR2,
        p_pay_amt IN NUMBER,
        p_pg_cd   IN VARCHAR2
    ) RETURN VARCHAR2 IS
        v_pay_no VARCHAR2(10);
    BEGIN
        SELECT LPAD(SQ_PAY_NO.NEXTVAL, 10, '0') INTO v_pay_no FROM DUAL;

        INSERT INTO TB_PAY_PG (PAY_NO, ACCT_NO, PAY_AMT, PG_CD, PG_STAT, REG_DTM)
        VALUES (v_pay_no, p_acct_no, p_pay_amt, p_pg_cd, 'REQ',
                TO_CHAR(SYSDATE, 'YYYYMMDDHH24MISS'));

        RETURN v_pay_no;
    END request_approval;

    PROCEDURE cancel_approval(
        p_pay_no IN  VARCHAR2,
        p_rc     OUT NUMBER
    ) IS
    BEGIN
        UPDATE TB_PAY_PG
           SET PG_STAT = 'CNL',
               CNL_DTM = TO_CHAR(SYSDATE, 'YYYYMMDDHH24MISS')
         WHERE PAY_NO  = p_pay_no
           AND PG_STAT = 'REQ';

        p_rc := SQL%ROWCOUNT;
    END cancel_approval;

    FUNCTION get_pg_status(p_pay_no IN VARCHAR2) RETURN VARCHAR2 IS
        v_stat VARCHAR2(3);
    BEGIN
        SELECT PG_STAT INTO v_stat FROM TB_PAY_PG WHERE PAY_NO = p_pay_no;
        RETURN v_stat;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            RETURN NULL;
    END get_pg_status;

END PKG_PAY_PG;
/
