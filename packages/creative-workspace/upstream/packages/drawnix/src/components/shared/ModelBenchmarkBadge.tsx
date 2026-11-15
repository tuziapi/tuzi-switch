/**
 * 模型测试收藏/淘汰徽章
 * 在模型选择器中展示该模型在 benchmark 中的收藏/淘汰状态
 */

import React from 'react';
import { Star, XCircle } from 'lucide-react';
import { modelBenchmarkService } from '../../services/model-benchmark-service';
import './model-benchmark-badge.scss';
import { HoverTip } from './hover';

export interface ModelBenchmarkBadgeProps {
  modelId: string;
}

export const ModelBenchmarkBadge: React.FC<ModelBenchmarkBadgeProps> = ({
  modelId,
}) => {
  const summary = modelBenchmarkService.getModelBenchmarkSummary(modelId);

  if (!summary.hasFavorite && !summary.hasRejected) {
    return null;
  }

  return (
    <span className="model-benchmark-badge">
      {summary.hasFavorite && (
        <HoverTip
          content="已在测试中收藏"
          theme="light"
          showArrow={false}
          zIndex={20000}
        >
          <Star size={12} className="model-benchmark-badge__star" />
        </HoverTip>
      )}
      {summary.hasRejected && (
        <HoverTip
          content="已在测试中淘汰"
          theme="light"
          showArrow={false}
          zIndex={20000}
        >
          <XCircle size={12} className="model-benchmark-badge__reject" />
        </HoverTip>
      )}
    </span>
  );
};
