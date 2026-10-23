CREATE OR REPLACE PACKAGE PKG_PAY_PG AS
    /* PG 연동 결제 패키지 명세 — 2026-07-30 신규 */

    FUNCTION request_approval(
        p_acct_no IN VARCHAR2,
        p_pay_amt IN NUMBER,
        p_pg_cd   IN VARCHAR2
    ) RETURN VARCHAR2;

    PROCEDURE cancel_approval(
        p_pay_no IN  VARCHAR2,
        p_rc     OUT NUMBER
    );

    FUNCTION get_pg_status(p_pay_no IN VARCHAR2) RETURN VARCHAR2;

END PKG_PAY_PG;
/
