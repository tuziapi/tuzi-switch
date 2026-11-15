/**
 * asset-embed Milkdown 插件
 *
 * 将 ![type|name](asset://id) 解析为自定义 assetEmbed 节点，
 * 用 React NodeView 渲染图片/视频/音频。
 */
export { remarkAssetEmbed } from './remark-plugin';
export { assetEmbedSchema } from './schema';
export { assetEmbedView } from './view';

import type { MilkdownPlugin } from '@milkdown/kit/ctx';
import { remarkAssetEmbed } from './remark-plugin';
import { assetEmbedSchema } from './schema';
import { assetEmbedView } from './view';

export const assetEmbedPlugins: MilkdownPlugin[] = [
  remarkAssetEmbed,
  assetEmbedSchema.ctx,
  assetEmbedSchema.node,
  assetEmbedView,
].flat();
