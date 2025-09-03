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

def get_states():
    s = get("/state").json()["data"]
    status = s.get("status")
    msgs = s.get("messages", [])

    final_state = False
    states = []
    for m in msgs:
        if m.get("from") == "gpt":
            states.append({
                "value": m.get("value"),
                "predictions": [],
                "image": m.get("screenshotBase64WithElementMarker")
            })
            steps = m.get("predictionParsed") or []
            for step in steps:
                states[-1]["predictions"].append({
                    "thought": step.get("thought"),
                    "action": f"{step.get('action_type')}: {step.get('action_inputs')}"
                })

    if status.lower() in ("end", "error", "user_stopped"):
        final_state = True
    
    return final_state, states

# 1) 可选清空
post("/agent/clear")

# 2) 设置指令
# post("/agent/instructions", {"instructions": """下面是对yama程序的测试用例描述，请你逐个理解并执行相应的测试。最后给出测试总结 {
#             "suite_name": "终端交互与异常处理",
#             "suite_description": "测试终端窗口的交互性、对特殊输入和异常情况的处理能力。",
#             "test_cases": [
#               {
#                 "case_id": "TM_INT_001",
#                 "description": "在终端中输入包含特殊字符的命令（如`echo \"Hello & World!\"`），验证命令是否能正确解析并执行。",
#                 "expected_result": "命令成功执行，特殊字符被正确处理，并返回预期结果。"
#               },
#               {
#                 "case_id": "TM_INT_002",
#                 "description": "输入一个非常长的命令（超过一行显示），验证终端是否能正确处理并执行。",
#                 "expected_result": "长命令能被完整输入并执行，终端显示结果正常。"
#               },
#               {
#                 "case_id": "TM_INT_004",
#                 "description": "调整远程终端窗口的大小，验证内容显示和滚动条功能是否正常。",
#                 "expected_result": "终端内容根据窗口大小自动调整，当内容超出显示范围时，滚动条出现并可正常使用。"
#               },
#               {
#                 "case_id": "TM_INT_005",
#                 "description": "从外部复制一段文本（如一个命令或一段脚本），尝试粘贴到远程终端中，验证是否能成功粘贴并执行。",
#                 "expected_result": "文本能成功粘贴到终端输入行，并可正常执行。"
#               }
#             ]
#           }"""})
post("/agent/instructions", {"instructions":"""打开浏览器，搜索滑板鞋"""})
# 3) 运行
post("/agent/run")

# 4) 轮询日志
import signal
import sys

def handle_sigint(signum, frame):
    print("\n检测到Ctrl+C，正在关闭agent...")
    try:
        post("/agent/stop")
    except Exception as e:
        print(f"关闭agent时出错: {e}")
    sys.exit(0)

signal.signal(signal.SIGINT, handle_sigint)
time.sleep(1)
states = []
while True:
    final_state, _states = get_states()
    if final_state:
        break
    if len(states) < len(_states):
        states = _states
        state = states[-1]
        print(state["value"])
        print(f"Image: {state['image'][:20]}")
        print("---")
    time.sleep(0.8)