<div align="center">

# tuzi-switch

### Claude Code、Codex、Gemini、OpenClaw 向けの Tuzi 業務デスクトップアシスタント

[![Version](https://img.shields.io/github/v/release/tuziapi/tuzi-switch?color=0ea5e9&label=version)](https://github.com/tuziapi/tuzi-switch/releases)
[![Downloads](https://img.shields.io/github/downloads/tuziapi/tuzi-switch/total?color=f97316)](https://github.com/tuziapi/tuzi-switch/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-94a3b8)](https://github.com/tuziapi/tuzi-switch/releases)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-111827)](https://tauri.app/)

[中文](README.md) | [English](README_EN.md) | 日本語 | [Releases](https://github.com/tuziapi/tuzi-switch/releases)

</div>

## ダウンロード

最新のインストーラは [GitHub Releases](https://github.com/tuziapi/tuzi-switch/releases) から取得できます。

推奨パッケージ:

- Windows: `.msi`
- Windows ポータブル版: 現在の Release に含まれる場合は `Windows-Portable.zip`
- Linux: `.AppImage`、`.deb`、`.rpm`
- macOS: `macOS-unsigned.dmg` または `macOS-unsigned.zip`

現在の公開 Release は Windows / Linux での利用を前提にしています。macOS は未署名のテストビルドです。

### ワンコマンドインストール

現在の推奨版 `v3.12.16` を直接インストール:

```bash
curl -fsSL https://raw.githubusercontent.com/tuziapi/tuzi-switch/main/scripts/install_tuzi_switch.sh | env TUZI_SWITCH_TAG=v3.12.16 bash
```

補足:

- 現在の Release workflow は引き続き `prerelease` 方式で公開されています
- GitHub の `releases/latest` では、最新のテスト版を安定して取得できない場合があります
- README のコマンドは `v3.12.16` に固定し、現在の推奨版を確実に入れられるようにしています
- 別バージョンを入れたい場合は `TUZI_SWITCH_TAG=vX.Y.Z` の値を差し替えてください

### macOS 未署名ビルド

初回起動時に macOS にブロックされた場合は、次のいずれかを実行してください。

1. アプリを右クリックして `開く` を選び、確認ダイアログでもう一度 `開く` を押す
2. またはターミナルで以下を実行する

```bash
xattr -dr com.apple.quarantine "/Applications/tuzi-switch.app"
open "/Applications/tuzi-switch.app"
```

`/Applications` 以外に配置した場合は、パスを実際の場所に置き換えてください。

## tuzi-switch とは

tuzi-switch は CC Switch をベースにした Tuzi 業務向けのカスタム版です。多ツール管理の基盤は残しつつ、Tuzi のお客様がより簡単に接続できる導線を優先しています。

現在の中心入口は次の 4 つです。

- Claude Code
- Codex
- Gemini
- OpenClaw

ユーザーは Tuzi Key を 1 回入力するだけで、ルート設定とローカル設定をより素早く完了できます。設定ファイルを手動編集する前提ではありません。

## 現在のバージョン更新内容

現在の公開版は `v3.12.16` で、今回の主な更新は以下です。

- Claude、Codex、Gemini の状態判定を、installer 記録だけではなく、実際に命中した CLI、パッケージ metadata、current provider を軸に再整理
- Quick Access と下部 ProviderList の切替後更新を原子的に揃え、上部の `Current Route / Base URL / CLI Variant` と下部カードが長く食い違わないよう改善
- Claude の provider 切替後に、route file、shell rc、`~/.claude/settings.json`、current provider を後端で収束させ、ルート飛びやソース衝突を減らす
- Codex / Gemini の改版インストールに launcher 競合除去、インストール後検証、実変体チェックを追加し、Codex のモデルチェックも実際の model / reasoning effort / endpoint に合わせて修正
- 改版切替の復元ロジックを `last original route / provider` ベースで統一し、改版突入時は原版 current provider をクリア、退出時は記録から復元
- 現在のルート判定ロジック文書を追加し、ワンコマンドインストールも推奨版固定のまま維持

## 製品のポイント

- Claude Code、Codex、Gemini、OpenClaw 向けの Tuzi 優先クイック入口
- メイン画面から Tuzi / GAC ラインの案内付きで接続設定を実行
- Tuzi ブランドのビジュアル、アイコン、接入カード
- アプリ内でのプロバイダ切り替えとデスクトップ版ベースのトレイ切り替え導線
- Providers、MCP、Prompts、Skills など既存基盤機能を継続利用
- Tauri 2 ベースのデスクトップアプリ構成

## 現在のカスタマイズ方針

上流版と比べると、この版は汎用的な高機能ツールというより、業務導入と顧客オンボーディングを重視しています。

- 右上の入口エリアを Tuzi 接続フロー向けに再構成
- Claude Code、Codex、Gemini、OpenClaw に個別のインストール / 設定入口を用意
- Tuzi クイック設定を主要導線として前面に配置
- 一部の汎用設定や構成フローを簡素化

## 画面プレビュー

### Claude

![Claude Tuzi Flow](assets/screenshots/claude-tuzi.png)

### Codex

![Codex Tuzi Flow](assets/screenshots/codex-tuzi.png)

### Gemini

![Gemini Tuzi Flow](assets/screenshots/gemini-tuzi.png)

### OpenClaw

![OpenClaw Tuzi Flow](assets/screenshots/openclaw-tuzi.png)

## クイックスタート

1. [Releases](https://github.com/tuziapi/tuzi-switch/releases) から最新版をダウンロード
2. `tuzi-switch` を起動
3. Claude Code、Codex、Gemini、OpenClaw のいずれかを選択
4. ガイドに従って Tuzi Key を入力
5. ワンクリック設定を完了して利用開始

## 主な機能

### ツール入口

- Claude Code、Codex、Gemini、OpenClaw の独立した入口
- 対応ツール向けのインストール / 更新ガイド
- 汎用プロバイダ設定よりも業務導線を優先した画面構成

### プロバイダ管理

- プロバイダの追加、編集、有効化、無効化、インポート、エクスポート
- 適用可能な範囲で複数ツールへ同一設定を同期
- アプリ内から現在のプロバイダを切り替え

### MCP、Prompts、Skills

- MCP の基本管理機能を継続搭載
- 対応ツール間の Prompt ファイル同期を維持
- 上流デスクトップ基盤由来の Skills インストール / 同期フローを利用

注記:

- 一部の同期挙動はツールごとに差があります
- OpenClaw 関連の一部連携機能は引き続き調整中です

### データとローカル保存先

上流との互換性維持のため、ローカルデータは現在も CC Switch の保存パスを利用しています。

- `~/.cc-switch/cc-switch.db`
- `~/.cc-switch/settings.json`
- `~/.cc-switch/backups/`
- `~/.cc-switch/skills/`

## 開発計画 / TODO

- 完了: Claude / Codex / Gemini の current route、CLI 変体、Base URL、provider 現在状態の表示優先順位と更新連動を収束
- 完了: Claude provider 切替後の route file / shell rc / settings.json / current provider 収束と、改版状態の誤表示修正
- 完了: Codex / Gemini 改版インストール時の launcher 競合除去、インストール後検証、実変体チェック、Codex モデルチェック経路の修正
- 完了: README のワンコマンドインストールとインストールスクリプト例を `v3.12.16` に更新し、現在ルート文書への入口も追加
- 進行中: ライト / ダーク両テーマで、ルートカード、状態ブロック、下部リスト高亮、各入口の文案密度をさらに揃える
- 進行中: provider / proxy / openclaw 周辺に残る順序依存型 Rust flaky tests を整理して減らす
- 次: セッション管理と復元戦略を引き続き整理する
- 次: release workflow をより安定した `latest` 導線と署名配布体験へ寄せていく

## 補足

- このリポジトリは Tuzi 業務シナリオ向けのカスタム分岐です
- 一部の文書や内部パスには上流由来の命名が残っています
- 配布パッケージはこのリポジトリの GitHub Releases から提供されます

## クレジット

tuzi-switch はオープンソースの CC Switch を土台として構築されています。その上で、Tuzi 業務フローに合う体験へ再設計を進めています。
