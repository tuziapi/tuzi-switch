import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import './OpenTuConnectionGuide.css';

const messages = {
  zh: {
    title: "三步开始使用",
    steps: [
      "点击“连接本机 Codex”。首次连接后，重新打开客户端，让它加载 tuzi-opentu。",
      "在“创作配置”选好模型，然后打开目标画布，并保持兔子助手运行。",
      "把下面的指令粘贴到客户端。若出现工具调用授权提示，确认后继续。",
    ],
    readTitle: "先试试读取画布",
    read: "请调用 tuzi-opentu 读取当前画布，告诉我有多少个元素。",
    imageTitle: "生成图片并显示到画布",
    image:
      "请使用 tuzi-opentu，先查看可用图片模型，再生成一张奶白色陶瓷兔子台灯的产品图，完成后放入当前画布。只生成 1 张，并查询任务确认完成；不要重复提交生成。",
    copy: "复制指令",
    copied: "已复制，请粘贴到客户端发送。",
    failed: "复制失败，请选中文字手动复制。",
    note: "生成使用“创作配置”中的模型，可能产生费用。复制指令不会自动生成。",
    help: "工具没出现 / 图片没显示？",
    tips: "没有 tuzi-opentu：重新打开客户端并检查 MCP 是否启用。提示没有画布：回到助手，打开一个项目的画布。已提交生成：先查询任务，完成后插入已有结果，避免重复扣费。",
  },
  en: {
    title: "Get started in three steps",
    steps: [
      "Click “Connect Codex”. After the first setup, reopen the client to load tuzi-opentu.",
      "Choose a model in Creation settings, open the target canvas, and keep Tuzi Assistant running.",
      "Paste a prompt below into the client. Approve its tool request if prompted.",
    ],
    readTitle: "Try reading the canvas",
    read: "Use tuzi-opentu to read the current canvas and tell me how many elements it contains.",
    imageTitle: "Generate an image on the canvas",
    image:
      "Use tuzi-opentu to list available image models, then generate one product photo of a cream ceramic rabbit-shaped lamp and insert it into the current canvas. Generate exactly one image and check the task until it completes; do not submit duplicate generation requests.",
    copy: "Copy prompt",
    copied: "Copied. Paste it into the client and send.",
    failed: "Copy failed. Select the text and copy it manually.",
    note: "Generation uses your Creation settings and may incur charges. Copying a prompt does not start generation.",
    help: "Missing tools or images?",
    tips: "No tuzi-opentu: reopen the client and check that the MCP server is enabled. No canvas: open a project canvas in the assistant. Generation submitted: check the task and insert its existing result when complete; avoid duplicate charges.",
  },
  ja: {
    title: "3 ステップで使い始める",
    steps: [
      "「Codex に接続」をクリックします。初回設定後はクライアントを開き直し、tuzi-opentu を読み込みます。",
      "創作設定でモデルを選び、対象キャンバスを開いて、兔子助手を起動したままにします。",
      "以下の指示をクライアントに貼り付けます。ツール利用の確認が表示されたら承認してください。",
    ],
    readTitle: "キャンバスを読み取る",
    read: "tuzi-opentu で現在のキャンバスを読み取り、要素の数を教えてください。",
    imageTitle: "画像を生成してキャンバスに表示",
    image:
      "tuzi-opentu で利用可能な画像モデルを確認し、クリーム色の陶器製ウサギ型ランプの商品写真を1枚だけ生成して、現在のキャンバスに挿入してください。タスクの完了を確認し、生成リクエストを重複送信しないでください。",
    copy: "指示をコピー",
    copied: "コピーしました。クライアントに貼り付けて送信してください。",
    failed:
      "コピーできませんでした。テキストを選択して手動でコピーしてください。",
    note: "生成には創作設定のモデルを使用し、料金が発生する場合があります。コピーだけでは生成しません。",
    help: "ツールや画像が表示されない場合",
    tips: "tuzi-opentu がない場合はクライアントを開き直し、MCP の有効状態を確認してください。キャンバスがない場合は助手でプロジェクトを開いてください。生成済みの場合はタスクを確認し、既存の結果を挿入して重複課金を避けてください。",
  },
};

export function OpenTuConnectionGuide({
  language = "zh",
}: {
  language?: string;
}) {
  const text =
    messages[
      language.startsWith("zh") ? "zh" : language.startsWith("ja") ? "ja" : "en"
    ];
  const [feedback, setFeedback] = useState<"copied" | "failed" | null>(null);
  const copy = async (prompt: string) => {
    setFeedback(null);
    try {
      await invoke("copy_text_to_clipboard", { text: prompt });
      setFeedback("copied");
    } catch {
      setFeedback("failed");
    }
  };
  return (
    <section className="opentu-connection-guide" aria-label={text.title}>
      <h4>{text.title}</h4>
      <ol>
        {text.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {[
        { title: text.readTitle, prompt: text.read },
        { title: text.imageTitle, prompt: text.image },
      ].map((example) => (
        <article className="opentu-guide-example" key={example.title}>
          <header>
            <strong>{example.title}</strong>
            <button
              type="button"
              aria-label={`${text.copy}：${example.title}`}
              onClick={() => void copy(example.prompt)}
            >
              {text.copy}
            </button>
          </header>
          <p>{example.prompt}</p>
        </article>
      ))}
      {feedback && (
        <p role={feedback === "failed" ? "alert" : "status"}>
          {text[feedback]}
        </p>
      )}
      <p className="opentu-guide-note">{text.note}</p>
      <details>
        <summary>{text.help}</summary>
        <p>{text.tips}</p>
      </details>
    </section>
  );
}
