#!/usr/bin/env python3
"""中文全形標點檢查。

半形標點混在中文裡看起來很廉價，而且一旦漏掉就會直接出現在使用者眼前
（例如「約 3.6 MB,接近瀏覽器上限」那句）。這支腳本由 git pre-commit hook
呼叫，發現就擋下 commit —— 不靠人記得。

判斷規則刻意保守：只有「標點兩側是中文字（或全形收尾符號、HTML 結束標籤、
換行）」才算違規，所以程式碼裡的逗號不會被誤判 —— 那些前面一定是引號或括號。

用法：
    python3 tools/check-punctuation.py index.html          # 檢查
    python3 tools/check-punctuation.py --fix index.html    # 直接修
"""
import re
import sys

CJK = r'一-鿿々〆'
CLOSERS = r'）」』】》'

# (名稱, 樣式, 全形替代)
RULES = [
    ('逗號 ,',  rf'(?<=[{CJK}]),(?=[{CJK}])',        '，'),
    ('逗號 ,',  rf'(?<=[{CLOSERS}]),(?=[{CJK}])',    '，'),
    ('逗號 ,',  rf'(?<=>),(?=[{CJK}])',              '，'),
    ('逗號 ,',  rf'(?<=\}}),(?=[{CJK}])',             '，'),
    ('逗號 ,',  rf'(?<=[{CJK}]),(?=\s*\n)',          '，'),
    ('逗號 ,',  rf'(?<=[A-Za-z0-9%）]),(?=[{CJK}])', '，'),
    ('逗號 ,',  rf'(?<=[{CJK}]),(?=[A-Za-z0-9])',    '，'),
    ('問號 ?',  rf'(?<=[{CJK}])\?',                  '？'),
    ('問號 ?',  rf'(?<=[{CLOSERS}])\?(?=[{CJK}])',   '？'),
    ('冒號 :',  rf'(?<=[{CJK}]):',                   '：'),
    ('分號 ;',  rf'(?<=[{CJK}]);',                   '；'),
    ('分號 ;',  rf'(?<=[0-9\}}\)]);(?=[{CJK}])',        '；'),
    ('冒號 :',  rf'(?<=[0-9\}}\)]):(?=[{CJK}])',        '：'),
    ('驚嘆 !',  rf'(?<=[\}}\)])!(?=[{CJK}])',           '！'),
    ('驚嘆 !',  rf'(?<=[{CJK}])!',                   '！'),
    # 2026-10 補：README 裡抓不到的樣式
    ('逗號 ,',  rf'(?<=\*\*),(?=[{CJK}])',             '，'),   # **粗體**,中文
    ('冒號 :',  rf'(?<=\*\*):(?=[{CJK}])',             '：'),   # **粗體**:中文
    ('逗號 ,',  rf'(?<=[{CLOSERS}]),(?=\s*\n)',        '，'),   # 「引號」, 換行
    ('冒號 :',  rf'(?<=[{CLOSERS}]):(?=\s*\n)',        '：'),   # （括號）: 換行
    ('逗號 ,',  rf'(?<=[A-Za-z0-9]),(?=`)',             '，'),   # HTTPS,`localhost`
    ('左括 (',  rf'\((?=[{CJK}])',                   '（'),
    ('右括 )',  rf'(?<=[{CJK}])\)',                  '）'),
]


def scan(text):
    hits = []
    for name, pat, _ in RULES:
        for m in re.finditer(pat, text):
            line = text[:m.start()].count('\n') + 1
            ctx = text[max(0, m.start() - 26):m.end() + 18].replace('\n', '⏎')
            hits.append((line, name, ctx))
    return sorted(set(hits))


def fix(text):
    for _, pat, rep in RULES:
        text = re.sub(pat, rep, text)
    # 補上配對：一邊全形一邊半形的括號
    text = re.sub(r'（([^（）()\n]*)\)', r'（\1）', text)
    text = re.sub(r'\(([^（）()\n]*)）', r'（\1）', text)
    return text


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    do_fix = '--fix' in sys.argv
    if not args:
        print('用法：check-punctuation.py [--fix] <檔案...>')
        return 1

    failed = False
    for path in args:
        with open(path, encoding='utf-8') as f:
            text = f.read()
        if do_fix:
            new = fix(text)
            if new != text:
                with open(path, 'w', encoding='utf-8') as f:
                    f.write(new)
                print(f'✅ {path}：已修正')
            else:
                print(f'✅ {path}：本來就乾淨')
            continue
        hits = scan(text)
        if hits:
            failed = True
            print(f'❌ {path}：發現 {len(hits)} 處半形標點')
            for line, name, ctx in hits[:15]:
                print(f'   行 {line} [{name}] …{ctx}…')
            if len(hits) > 15:
                print(f'   …另有 {len(hits) - 15} 處')
        else:
            print(f'✅ {path}：全形標點檢查通過')

    if failed:
        print('\n修正方式：python3 tools/check-punctuation.py --fix index.html')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
