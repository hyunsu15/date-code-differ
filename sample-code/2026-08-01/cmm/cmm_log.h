#ifndef _CMM_LOG_H_
#define _CMM_LOG_H_

#define LOG_LV_DEBUG 0
#define LOG_LV_INFO  1
#define LOG_LV_WARN  2
#define LOG_LV_ERROR 3

int  log_open(const char *path);
void log_set_level(int level);
void log_write(const char *level, const char *msg);
void log_close(void);

#endif
