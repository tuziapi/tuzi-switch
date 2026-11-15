/**
 * 模型健康状态 Hook
 * 
 * 提供模型健康状态数据，支持自动刷新
 * 仅当 baseUrl 为 api.tu-zi.com 时才启用
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
    geminiSettings,
    providerProfilesSettings,
    type ProviderProfile,
} from '../utils/settings-manager';
import {
    buildModelHealthKey,
    modelHealthFetcher,
    buildHealthMap,
    isTuziApiUrl,
    shouldFetchModelHealthForSelections,
    type ModelHealthSelection,
    type ModelHealthStatus,
} from '../services/model-health-service';

export interface UseModelHealthResult {
    /** 模型 ID 到健康状态的映射 */
    healthMap: Map<string, ModelHealthStatus>;
    /** 是否正在加载 */
    loading: boolean;
    /** 错误信息 */
    error: string | null;
    /** 是否应该显示健康状态（baseUrl 为 tu-zi.com 时为 true） */
    shouldShowHealth: boolean;
    /** 更新当前已选择的模型，用于决定是否请求健康状态 */
    setActiveSelections: (selections: ModelHealthSelection[]) => void;
    /** 手动刷新数据 */
    refresh: () => Promise<void>;
    /** 根据模型 ID 和供应商获取健康状态 */
    getHealthStatus: (modelId: string, profileId?: string | null) => ModelHealthStatus | undefined;
}

// UI 刷新间隔（5 分钟）- 用于定时器
// 注意：实际 API 调用频率由 modelHealthFetcher 单例控制（最小 1 分钟）
const UI_REFRESH_INTERVAL = 5 * 60 * 1000;

/**
 * 模型健康状态 Hook
 */
export function useModelHealth(): UseModelHealthResult {
    const [healthMap, setHealthMap] = useState<Map<string, ModelHealthStatus>>(() => {
        // 初始化时使用单例的缓存数据
        const cached = modelHealthFetcher.getCachedData();
        return cached.length > 0 ? buildHealthMap(cached) : new Map();
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [shouldShowHealth, setShouldShowHealth] = useState(false);
    const intervalRef = useRef<NodeJS.Timeout | null>(null);
    const [providerProfiles, setProviderProfiles] = useState<ProviderProfile[]>(
        () => providerProfilesSettings.get()
    );
    const activeSelectionsRef = useRef<ModelHealthSelection[]>([]);

    // 检查是否应该显示健康状态
    const checkShouldShow = useCallback(() => {
        const settings = geminiSettings.get();
        const profiles = providerProfilesSettings.get();
        const show = shouldFetchModelHealthForSelections(
            activeSelectionsRef.current,
            profiles,
            settings.baseUrl || ''
        );
        setShouldShowHealth(show);
        setProviderProfiles(profiles);
        return show;
    }, []);

    // 获取健康数据
    const fetchData = useCallback(async (force: boolean = false) => {
        // 检查是否应该显示
        if (!checkShouldShow()) {
            return;
        }

        setLoading(true);
        setError(null);

        try {
            // 使用单例获取数据，单例内部会处理缓存和并发控制
            const data = await modelHealthFetcher.fetch(5, force);
            const newMap = buildHealthMap(data);
            setHealthMap(newMap);
        } catch (err: unknown) {
            console.warn('[useModelHealth] Failed to fetch:', err);
            const errorMessage = err instanceof Error ? err.message : 'Failed to fetch health data';
            setError(errorMessage);
        } finally {
            setLoading(false);
        }
    }, [checkShouldShow]);

    // 手动刷新
    const refresh = useCallback(async () => {
        await fetchData(true);
    }, [fetchData]);

    const setActiveSelections = useCallback(
        (selections: ModelHealthSelection[]) => {
            activeSelectionsRef.current = selections;
            const show = checkShouldShow();

            if (show && !intervalRef.current) {
                fetchData();
                intervalRef.current = setInterval(() => {
                    fetchData(true);
                }, UI_REFRESH_INTERVAL);
            } else if (!show && intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
                setHealthMap(new Map());
            } else if (!show) {
                setHealthMap(new Map());
            }
        },
        [checkShouldShow, fetchData]
    );

    // 获取特定模型的健康状态
    const getHealthStatus = useCallback((modelId: string, profileId?: string | null): ModelHealthStatus | undefined => {
        const profile =
            typeof profileId === 'string' && profileId
                ? providerProfiles.find((item) => item.id === profileId) || null
                : null;

        if (profile) {
            if (!isTuziApiUrl(profile.baseUrl || '')) {
                return undefined;
            }

            return healthMap.get(
                buildModelHealthKey(modelId, profile.pricingGroup || 'default')
            );
        }

        const settings = geminiSettings.get();
        if (!isTuziApiUrl(settings.baseUrl || '')) {
            return undefined;
        }

        return healthMap.get(buildModelHealthKey(modelId, 'default'));
    }, [healthMap, providerProfiles]);

    // 初始化和定时刷新
    useEffect(() => {
        // 初始检查
        const show = checkShouldShow();

        if (show) {
            // 首次加载
            fetchData();

            // 设置定时刷新（UI 级别，实际调用频率由单例控制）
            intervalRef.current = setInterval(() => {
                fetchData(true);
            }, UI_REFRESH_INTERVAL);
        }

        // 监听设置变化
        const handleSettingsChange = () => {
            const newShow = checkShouldShow();
            if (newShow && !intervalRef.current) {
                fetchData();
                intervalRef.current = setInterval(() => {
                    fetchData(true);
                }, UI_REFRESH_INTERVAL);
            } else if (!newShow && intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
                setHealthMap(new Map());
            }
        };

        geminiSettings.addListener(handleSettingsChange);
        providerProfilesSettings.addListener(handleSettingsChange);

        return () => {
            geminiSettings.removeListener(handleSettingsChange);
            providerProfilesSettings.removeListener(handleSettingsChange);
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
            }
        };
    }, [checkShouldShow, fetchData]);

    return {
        healthMap,
        loading,
        error,
        shouldShowHealth,
        setActiveSelections,
        refresh,
        getHealthStatus,
    };
}

export type { ModelHealthStatus };
