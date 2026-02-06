/**
 * Quick script: connect to echo1, send "hello", read the reply.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "../..");

async function main() {
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/index.ts"],
    cwd: projectRoot,
  });
  const client = new Client({ name: "cli", version: "1.0.0" });
  await client.connect(transport);

  // 1. 连接 echo 服务器
  const conn = await client.callTool({
    name: "connect_stream",
    arguments: { url: "ws://localhost:8765", protocol: "ws", channel_id: "echo1" },
  });
  console.log("── 连接结果 ──");
  console.log((conn.content as any)[0].text);
  console.log();

  // 等待 welcome 消息到达
  await new Promise((r) => setTimeout(r, 1000));

  // 2. 发送 hello
  const send = await client.callTool({
    name: "send_message",
    arguments: { channel_id: "echo1", payload: "hello" },
  });
  console.log("── 发送结果 ──");
  console.log((send.content as any)[0].text);
  console.log();

  // 等待 echo 回复
  await new Promise((r) => setTimeout(r, 1000));

  // 3. 读取最新消息
  const latest = await client.readResource({ uri: "stream://echo1/messages/latest" });
  console.log("── 最新消息（echo 服务器的回复） ──");
  console.log((latest.contents[0] as any).text);
  console.log();

  // 4. 读取全部最近消息
  const recent = await client.readResource({ uri: "stream://echo1/messages/recent" });
  console.log("── 全部最近消息 ──");
  console.log((recent.contents[0] as any).text);

  // 清理
  await client.callTool({
    name: "disconnect_stream",
    arguments: { channel_id: "echo1" },
  });
  await client.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
