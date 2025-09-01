# client.py
import os, time, requests

PORT = int(os.environ.get("UI_TARS_API_PORT", "10086"))
BASE = f"http://127.0.0.1:{PORT}"
TOKEN = os.environ.get("UI_TARS_API_TOKEN")
HEADERS = {"Authorization": f"Bearer {TOKEN}"} if TOKEN else {}

def post(path, json=None):
    return requests.post(BASE + path, json=json, headers=HEADERS, timeout=30)

def get(path):
    return requests.get(BASE + path, headers=HEADERS, timeout=30)

# 1) 可选清空
post("/agent/clear")

# 2) 设置指令
post("/agent/instructions", {"instructions": "打开浏览器搜索 滑板鞋"})

# 3) 运行
post("/agent/run")

# 4) 轮询日志
seen = 0
while True:
    s = get("/state").json()["data"]
    status = s.get("status")
    msgs = s.get("messages", [])
    # 打印新增消息里的 gpt 步骤
    for m in msgs[seen:]:
        if m.get("from") == "gpt":
            steps = m.get("predictionParsed") or []
            for step in steps:
                print("Thought:", step.get("thought"))
                print("Action:", step.get("action_type"), step.get("action_inputs"))
                print("---")
    seen = len(msgs)
    if status.lower() in ("end", "error", "user_stopped"):
        print(f"done with status: {status}, error: {s.get('errorMsg')}")
        break
    time.sleep(0.8)