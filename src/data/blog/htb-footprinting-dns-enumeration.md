---
title: "HTB Footprinting DNS Enumeration — .203 호스트 하나 찾겠다고 반나절 날린 삽질기"
pubDatetime: 2026-04-19T12:00:00+09:00
tags: ["HTB", "footprinting", "DNS", "enumeration", "AXFR", "gobuster", "writeup"]
description: "HTB Academy Footprinting 모듈 DNS Enumeration 섹션 풀이. 'x.x.x.203으로 끝나는 호스트의 FQDN을 찾아라' 한 문제에 AXFR, PTR, 다중 depth 서브도메인 브포를 다 쏟아붓고도 막히다가 bitquark 워드리스트 교체 한 번에 뚫린 기록."
---

## 개요

HTB Academy Footprinting 모듈 DNS Enumeration 섹션. 문제는 짧다.

- **`x.x.x.203`으로 끝나는 IP를 가진 호스트의 FQDN을 찾아라.**

"그거 AXFR 한 번이면 끝 아닌가?" 싶었는데 아니었다. 반나절 삽질했다. 결론부터 스포하면 **워드리스트 교체 한 번**이면 답이 나오는 문제였다. 그 워드리스트를 네 번째에 만났다.

사용한 기법:
- `dig`로 SOA / NS / TXT / ANY 조회
- AXFR(Zone Transfer)로 1·2차 서브도메인 수집
- PTR 역방향 조회 (`-x`)
- `gobuster dns` 서브도메인 브루트포싱 (2-depth, 3-depth, 4-depth)
- MX / SRV / 수동 mail 네이밍 probe
- **워드리스트 교체** (`subdomains-top1million` → `bitquark`)

---

## 1. 초기 정찰 — SOA / NS / 버전 / ANY

타깃 NS는 `10.129.42.195`. 먼저 기본 정보부터.

### SOA 조회 (함정 하나)

```bash
# 공격자
┌──(netzy㉿kali)-[~]
└─$ dig soa 10.129.42.195

;; ->>HEADER<<- opcode: QUERY, status: NXDOMAIN, id: 62782
;; AUTHORITY SECTION:
.    5    IN    SOA    a.root-servers.net. nstld.verisign-grs.com. ...
;; SERVER: 192.168.0.2#53(192.168.0.2) (UDP)
```

여기서 잠깐. 응답해준 서버가 `192.168.0.2`(내 공유기)다. NS 지정을 안 해서 시스템 리졸버로 나간 것. 게다가 IP를 도메인처럼 질의해서 `NXDOMAIN`. 명령어 자체가 잘못됐다. 바로 수정.

### NS 조회

```bash
# 공격자
┌──(netzy㉿kali)-[~]
└─$ dig ns inlanefreight.htb @10.129.42.195

;; ANSWER SECTION:
inlanefreight.htb.      604800  IN      NS      ns.inlanefreight.htb.

;; ADDITIONAL SECTION:
ns.inlanefreight.htb.   604800  IN      A       127.0.0.1
```

NS의 A 레코드가 `127.0.0.1`로 위장돼 있다. 실제 응답은 `10.129.42.195`가 하고 있으니 레코드 상의 IP는 가짜.

### 버전 확인

```bash
# 공격자
┌──(netzy㉿kali)-[~]
└─$ dig CH TXT version.bind 10.129.42.195

;; ANSWER SECTION:
version.bind.    5    CH    TXT    "Unknown"
```

숨김 처리됨. 이건 정상적인 운영 관행이다.

### ANY 조회로 단서 수집

```bash
# 공격자
┌──(netzy㉿kali)-[~]
└─$ dig any inlanefreight.htb @10.129.42.195

inlanefreight.htb.  604800  IN  TXT   "v=spf1 include:mailgun.org include:_spf.google.com
                                       include:spf.protection.outlook.com include:_spf.atlassian.net
                                       ip4:10.129.124.8 ip4:10.129.127.2 ip4:10.129.42.106 ~all"
inlanefreight.htb.  604800  IN  TXT   "atlassian-domain-verification=t1rKCy68JFszSdCKVpw64A1QksWdXuYFUeSXKU"
inlanefreight.htb.  604800  IN  TXT   "MS=ms97310371"
inlanefreight.htb.  604800  IN  SOA   inlanefreight.htb. root.inlanefreight.htb. 2 604800 86400 2419200 604800
inlanefreight.htb.  604800  IN  NS    ns.inlanefreight.htb.
```

SPF 레코드에서 IP 대역 힌트를 얻었다.

| 대역 | 용도 추정 |
| --- | --- |
| 10.129.124.0/? | mailgun/메일 |
| 10.129.127.0/? | 메일 |
| 10.129.42.0/? | NS 본체 부근 |

이 대역들에 `.203` PTR 때리면 바로 답 나올 줄 알았다.

---

## 2. AXFR — 1차 서브도메인 수집

Zone Transfer가 허용되어 있으면 그 zone의 **모든 레코드**를 통째로 받을 수 있다. 제일 먼저 시도해야 할 수집 방법.

### inlanefreight.htb AXFR (성공)

```bash
# 공격자
┌──(netzy㉿kali)-[~]
└─$ dig axfr inlanefreight.htb @10.129.42.195

app.inlanefreight.htb.        604800  IN  A   10.129.18.15
dev.inlanefreight.htb.        604800  IN  A   10.12.0.1
internal.inlanefreight.htb.   604800  IN  A   10.129.1.6
mail1.inlanefreight.htb.      604800  IN  A   10.129.18.201
ns.inlanefreight.htb.         604800  IN  A   127.0.0.1
```

| subdomain | ip |
| --- | --- |
| app.inlanefreight.htb | 10.129.18.15 |
| dev.inlanefreight.htb | 10.12.0.1 |
| internal.inlanefreight.htb | 10.129.1.6 |
| mail1.inlanefreight.htb | 10.129.18.201 |
| ns.inlanefreight.htb | 10.129.42.195 |

**`.203` 없음.** 그럼 하위 zone들 AXFR도 시도.

### internal.inlanefreight.htb AXFR (성공)

```bash
# 공격자
┌──(netzy㉿kali)-[~]
└─$ dig axfr internal.inlanefreight.htb @10.129.42.195
```

| subdomain | ip |
| --- | --- |
| dc1.internal.inlanefreight.htb | 10.129.34.16 |
| dc2.internal.inlanefreight.htb | 10.129.34.11 |
| mail1.internal.inlanefreight.htb | 10.129.18.200 |
| ns.internal.inlanefreight.htb | 127.0.0.1 |
| vpn.internal.inlanefreight.htb | 10.129.1.6 |
| ws1.internal.inlanefreight.htb | 10.129.1.34 |
| ws2.internal.inlanefreight.htb | 10.129.1.35 |
| wsus.internal.inlanefreight.htb | 10.129.18.2 |

**또 `.203` 없음.** 근데 `mail1.internal = 10.129.18.200`이 눈에 띄었다. mail1 본체는 `.201`. **`.203`도 같은 메일 서버군일 가능성이 높다**고 판단.

### 나머지 zone AXFR (전부 실패)

```bash
# 공격자
└─$ dig axfr app.inlanefreight.htb @10.129.42.195
; Transfer failed.

└─$ dig axfr dev.inlanefreight.htb @10.129.42.195
; Transfer failed.

└─$ dig axfr mail1.inlanefreight.htb @10.129.42.195
; Transfer failed.
```

`+tcp` 붙여도 동일. `allow-transfer` ACL에서 허용된 zone이 `inlanefreight.htb`과 `internal.inlanefreight.htb` 둘 뿐.

---

## 3. PTR 역방향 조회 — 기대했지만 전부 0건

IP 대역 후보들에 `.203` 붙여서 `-x`로 역질의. 바로 답 나올 줄 알았다.

```bash
# 공격자
┌──(netzy㉿kali)-[~]
└─$ dig @10.129.42.195 -x 10.129.18.203

;; QUESTION SECTION:
;203.18.129.10.in-addr.arpa.   IN      PTR

;; AUTHORITY SECTION:
10.IN-ADDR.ARPA.        86400   IN      SOA     10.IN-ADDR.ARPA. . 0 28800 7200 604800 86400
```

**NOERROR + ANSWER 0** — zone은 관리되는데 해당 IP에 대한 PTR이 없다는 뜻. 요 환경은 역방향 등록 자체를 안 해놨다.

후보 IP 전부 때려봤지만 동일 결과.

```
10.129.124.203   → 없음
10.129.127.203   → 없음
10.129.31.203    → 없음
10.129.34.203    → 없음
10.129.18.203    → 없음  ← 제일 기대했던 대역
127.0.0.203      → 없음
10.129.1.203     → 없음
```

역방향 경로로는 못 푼다. 브포로 방향 전환.

---

## 4. 서브도메인 브루트포싱 — 첫 번째 벽

`gobuster dns` 세팅에서 한 번 삽질했다.

### 리졸버 폴백 문제

```bash
gobuster dns --domain inlanefreight.htb --resolver 10.129.42.195 \
  -w /usr/share/seclists/Discovery/DNS/subdomains-top1million-110000.txt \
  --threads 50
```

에러 폭탄.

```
[ERROR] error on word internal: lookup internal.inlanefreight.htb. on 192.168.0.2:53: server misbehaving
```

`--resolver 10.129.42.195`를 줬는데도 **192.168.0.2(공유기)**로 질의하고 있었다. 원인은 두 가지였다.
1. `--resolver` 인자에 **포트를 안 붙이면 시스템 리졸버로 폴백**하는 버전이 있음.
2. 타임아웃(`1s`)에 걸린 쿼리가 시스템 리졸버로 재시도됨.

해결.

```bash
# 포트 붙이고, 스레드 낮추고, 타임아웃 늘림
gobuster dns --domain inlanefreight.htb --resolver 10.129.42.195:53 \
  -w /usr/share/seclists/Discovery/DNS/subdomains-top1million-110000.txt \
  --threads 20 --timeout 10s --no-error
```

### 2-depth 결과 (app / dev / mail1 / ns)

| zone | 결과 |
| --- | --- |
| `inlanefreight.htb` | AXFR으로 확인한 5개 외 추가 없음 |
| `app.inlanefreight.htb` | **0건** |
| `dev.inlanefreight.htb` | **5건 발견** |
| `mail1.inlanefreight.htb` | **0건** |
| `ns.inlanefreight.htb` | **0건** |

`dev` zone에서 찾은 호스트:

| FQDN | ip |
| --- | --- |
| ns.dev.inlanefreight.htb | 127.0.0.1 |
| mail1.dev.inlanefreight.htb | 10.129.18.200 |
| dev1.dev.inlanefreight.htb | 10.12.3.6 |
| dev2.dev.inlanefreight.htb | 10.12.3.112 |
| vpnx.dev.inlanefreight.htb | 10.12.1.254 |

**여기도 `.203` 없음.** `mail1.dev = mail1.internal = 10.129.18.200` — 동일 메일 서버를 여러 zone에서 가리키고 있다는 사실만 추가 확인.

### 잠깐, dev zone이 따로 위임된 건가?

`ns.dev`를 발견했을 때 "이게 dev zone의 NS면 그 NS 상대로 AXFR 다시 해봐야겠다" 싶었다. 확인.

```bash
# 공격자
└─$ dig NS dev.inlanefreight.htb @10.129.42.195

;; ANSWER SECTION:
dev.inlanefreight.htb.  604800  IN  NS   ns.inlanefreight.htb.
```

`dev` zone의 NS는 **부모와 같은 서버**다. 즉 zone 분리는 돼있지만 권한 NS가 같은 머신. AXFR을 다시 해도 결과 같음. `ns.dev`는 그냥 leaf A 레코드였다.

---

## 5. 더 깊이 파기 — 여전히 막힘

여기서부터 몇 시간 체류했다.

### 3-depth / 4-depth 브포

`dev` 아래서 나온 호스트들(ns.dev, mail1.dev, dev1.dev, dev2.dev, vpnx.dev)을 각각 zone 취급해서 브포. **전부 0건.**

### `internal` 하위는 AXFR이 다 보여준 거 아닌가?

맞다. AXFR은 그 zone의 **모든 레코드**를 주기 때문에 `internal` 자체 레벨은 더 안 해도 된다. 단, `internal.*`이 하위 위임 zone이면 별개인데, AXFR 결과에 NS 레코드가 없었으므로 위임 없음 → 진짜 끝.

### MX / SRV 시도

mail 서버군이 `.200/.201`인데 `.203`이 `mail2` 같은 게 아닐까 싶어 MX 질의.

```bash
# 공격자
└─$ dig MX inlanefreight.htb @10.129.42.195

;; ->>HEADER<<- opcode: QUERY, status: NOERROR
;; flags: qr aa rd; QUERY: 1, ANSWER: 0, AUTHORITY: 1, ADDITIONAL: 1
```

**MX 레코드 없음.** SPF는 mailgun/google/outlook에 위임하는 형태니까 자체 MX가 없는 게 맞다. 가설 탈락.

AD DC가 있으니 `_msdcs`, `_ldap._tcp` 같은 SRV도 쳐봤는데 역시 소득 없음.

### 수동 mail 네이밍 probe

```bash
for n in mail mail2 mail3 mx mx1 mx2 smtp smtp2 relay webmail imap pop out outbound mailout; do
  ip=$(dig +short A $n.inlanefreight.htb @10.129.42.195)
  [ -n "$ip" ] && echo "$n.inlanefreight.htb → $ip"
done
```

**0건.** `mail2`도, `smtp`도, 아무것도 없었다.

### 머신 리셋

이 시점에서 NS IP가 `10.129.67.99`로 바뀌었다(HTB 머신 재시작). 전체를 다시 검증했지만 zone 데이터는 동일.

여기까지 정리:
- AXFR 2개 zone 성공, 3개 실패 → 확인 가능한 호스트에 `.203` 없음
- PTR 후보 7개 전부 없음
- 2~4 depth 브포 완료, dev만 뚫리고 나머지 0
- MX/SRV 없음
- 수동 mail 네이밍 0건

**이쯤 되면 문제를 잘못 이해한 건가 싶어서 힌트를 다시 봤다.**

> *Remember that different wordlists do not always have the same entries.*

아.

---

## 6. 돌파구 — 워드리스트 교체

`subdomains-top1million-110000.txt`는 이름대로 **구글 상위 트래픽 도메인 기반**이다. `facebook`, `youtube`, `github` 같은 공개 웹 서비스 위주. 기업 내부망의 인프라 호스트명(예: `mx-backup`, `relay-out`, `vpn-ext`)은 이 리스트에 잘 없다.

대체 후보:
- `namelist.txt` — DNS 전용 큐레이션
- `bitquark-subdomains-top100000.txt` — **실제 관측된 서브도메인 수집**
- `n0kovo_subdomains.txt` — 가장 포괄적(크기 큼)

### namelist 먼저

```bash
gobuster dns --domain inlanefreight.htb --resolver 10.129.67.99:53 \
  -w /usr/share/seclists/Discovery/DNS/namelist.txt \
  --threads 20 --timeout 10s --no-error
```

**0건.**

### bitquark 투입

```bash
gobuster dns --domain inlanefreight.htb --resolver 10.129.67.99:53 \
  -w /usr/share/seclists/Discovery/DNS/bitquark-subdomains-top100000.txt \
  --threads 20 --timeout 10s --no-error
```

**나왔다.** `*.inlanefreight.htb`에 `.203` IP를 가진 FQDN이 찍혔다. 10분 만에 끝났다.

### 시도한 워드리스트 요약

| # | 워드리스트 | 경로 | 결과 |
| --- | --- | --- | --- |
| 1 | subdomains-top1million-110000 | `/usr/share/seclists/Discovery/DNS/subdomains-top1million-110000.txt` | ❌ .203 없음 |
| 2 | subdomains-top1million-5000 | `/usr/share/seclists/Discovery/DNS/subdomains-top1million-5000.txt` | ❌ (하위 호스트 스캔용) |
| 3 | namelist | `/usr/share/seclists/Discovery/DNS/namelist.txt` | ❌ .203 없음 |
| 4 | **bitquark-subdomains-top100000** | `/usr/share/seclists/Discovery/DNS/bitquark-subdomains-top100000.txt` | ✅ **정답** |

---

## 7. 공격 흐름 요약

```
dig SOA / NS / CH TXT / ANY → NS 파악, SPF에서 IP 대역 3개 수집
    ↓
AXFR inlanefreight.htb → 5개 호스트 확보 (.203 없음)
    ↓
AXFR internal.inlanefreight.htb → 8개 호스트 추가 (.203 없음)
    ↓
AXFR app/dev/mail1 → 전부 Transfer failed
    ↓
PTR 역조회 (.203 후보 IP 7개) → 전부 NOERROR + ANSWER 0
    ↓
gobuster dns 2-depth (app, dev, mail1, ns) → dev에서 5개만 추가
    ↓
3-4 depth 브포 / MX / SRV / 수동 probe → 전부 0건
    ↓
[4시간 막힘]
    ↓
힌트 재확인: "different wordlists do not always have the same entries"
    ↓
namelist.txt → 0건
    ↓
bitquark-subdomains-top100000.txt → .203 FQDN 획득 ✅
```

---

## 8. 배운 점

- **AXFR 성공 = 그 zone은 완전체.** 하지만 하위 위임 zone(`NS` 레코드로 떨어져 나간 것)은 별개. 위임 여부는 AXFR 결과에 NS 레코드가 있는지로 판정한다.
- **PTR이 없는 건 서버 잘못이 아니다.** 많은 환경이 정방향만 등록하고 역방향은 내버려둔다. `NOERROR + ANSWER 0`을 `NXDOMAIN`과 구분할 줄 알아야 삽질 안 한다.
- **`--resolver`에 포트까지 붙여라.** `10.129.42.195`가 아니라 `10.129.42.195:53`. 안 붙이면 시스템 리졸버로 폴백하면서 `192.168.0.2`(홈 라우터)로 쿼리가 새는 버전이 있다. 로그의 "server misbehaving"이 이 증상의 시그니처.
- **워드리스트는 목적지를 탄다.** `subdomains-top1million`은 웹 중심이라 공개 SaaS 서브도메인 찾을 때만 쓸만하고, **인프라 네이밍(mail-relay, mx-backup, vpn-ext 류)은 `bitquark`가 압도적**이다. 순서는 `bitquark → namelist → n0kovo` 추천.
- **힌트는 장식이 아니다.** 이번 문제는 "다른 워드리스트"라고 대놓고 지시했는데, 기본 워드리스트로 4시간 삽질한 다음에야 힌트 섹션을 다시 봤다. 막히면 코드 말고 문제 본문부터 다시 읽자.
- **깊이 말고 폭을 먼저 넓히자 — 이번 삽질의 진짜 원인.** 돌아보면 나는 **하나의 워드리스트를 정답으로 가정**한 상태에서 그 위에서만 2-depth → 3-depth → 4-depth로 파고 내려갔다. 같은 2-depth에서 **다른 카테고리의 워드리스트**를 먼저 돌려봤어야 했다. 워드리스트는 하나의 샌드박스가 아니라 **같은 레벨에 놓인 대체 가능한 카테고리들의 집합**이다. 초반에는 깊이 대신 폭 — 2-depth에서 `top1million → bitquark → namelist → n0kovo`를 다 돌리고, 그래도 안 나오면 그때 3-depth로 내려가는 게 맞다. 이게 이번 문제에서 제일 크게 배운 것.
- **막혔을 때의 탈출 순서 (업데이트 버전).** `AXFR → PTR → 같은 depth에서 워드리스트 로테이션(bitquark/namelist/n0kovo) → 그 다음 depth 내리기 → 그 다음 MX/SRV/수동 probe`. 워드리스트 교체가 depth 증가보다 먼저다.
