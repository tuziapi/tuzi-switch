import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Button, MessagePlugin } from 'tdesign-react';
import { ImageUploadIcon, MediaLibraryIcon } from '../../icons';
import { MediaLibraryModal } from '../../media-library/MediaLibraryModal';
import type { Asset } from '../../../types/asset.types';
import {
  SelectionMode,
  AssetType,
  AssetSource,
} from '../../../types/asset.types';
import { useAssets } from '../../../contexts/AssetContext';
import { HoverCard } from '../../shared';
import { Z_INDEX } from '../../../constants/z-index';
import {
  getAssetRuntimeUrl,
  isTauriEnvironment,
} from '../../../utils/desktop-asset-url';
import { assetStorageService } from '../../../services/asset-storage-service';

const MAX_IMAGE_SIZE_BYTES = 25 * 1024 * 1024;
const COMPRESSION_THRESHOLD_BYTES = 10 * 1024 * 1024;
const MAX_MEDIA_LIBRARY_BATCH_COUNT = 10;

export interface ImageFile {
  file?: File;
  url?: string;
  name: string;
}

interface ImageUploadProps {
  images: ImageFile[];
  onImagesChange: (images: ImageFile[]) => void;
  language: 'zh' | 'en';
  disabled?: boolean;
  multiple?: boolean;
  label?: string;
  icon?: string;
  onError?: (error: string | null) => void;
  headerRight?: React.ReactNode;
}

export const ImageUpload: React.FC<ImageUploadProps> = ({
  images,
  onImagesChange,
  language,
  disabled = false,
  multiple = true,
  label,
  icon = '📷',
  onError,
  headerRight,
}) => {
  const [showMediaLibrary, setShowMediaLibrary] = useState(false);
  const { addAsset } = useAssets();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const moreFileInputRef = useRef<HTMLInputElement>(null);
  const replaceFileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = event.target.files;
    if (files) {
      const fileArray = Array.from(files);
      const formatValidFiles = fileArray.filter((file) =>
        file.type.startsWith('image/')
      );
      const sizeValidFiles = formatValidFiles.filter(
        (file) => file.size <= MAX_IMAGE_SIZE_BYTES
      );

      if (sizeValidFiles.length === 0) {
        onError?.(
          language === 'zh'
            ? '部分文件格式不支持或超过25MB限制'
            : 'Some files are not supported or exceed 25MB limit'
        );
        event.target.value = '';
        return;
      }

      // Process files with compression if needed
      const newImages: Array<{ file: Blob; name: string }> = [];

      for (const file of sizeValidFiles) {
        try {
          let fileToAdd: Blob = file;

          // Compress if file is 10-25MB
          if (file.size > COMPRESSION_THRESHOLD_BYTES) {
            const { compressImageBlob, getCompressionStrategy } = await import(
              '@aitu/utils'
            );
            const strategy = getCompressionStrategy(file.size / (1024 * 1024));
            const msgId = MessagePlugin.loading({
              content:
                language === 'zh'
                  ? `正在压缩图片 (${(file.size / 1024 / 1024).toFixed(
                      1
                    )}MB)...`
                  : `Compressing image (${(file.size / 1024 / 1024).toFixed(
                      1
                    )}MB)...`,
              duration: 0,
              placement: 'top',
            });

            try {
              fileToAdd = await compressImageBlob(file, strategy.targetSizeMB);
              MessagePlugin.close(msgId);
              MessagePlugin.success({
                content:
                  language === 'zh'
                    ? `压缩完成: ${(file.size / 1024 / 1024).toFixed(1)}MB → ${(
                        fileToAdd.size /
                        1024 /
                        1024
                      ).toFixed(1)}MB`
                    : `Compressed: ${(file.size / 1024 / 1024).toFixed(
                        1
                      )}MB → ${(fileToAdd.size / 1024 / 1024).toFixed(1)}MB`,
                duration: 2,
              });
            } catch (compressionErr) {
              MessagePlugin.close(msgId);
              console.error(
                '[ImageUpload] Compression failed:',
                compressionErr
              );
              onError?.(
                language === 'zh' ? '图片压缩失败' : 'Image compression failed'
              );
              continue;
            }
          }

          newImages.push({ file: fileToAdd, name: file.name });
        } catch (err) {
          console.error('[ImageUpload] Error processing file:', err);
          onError?.(
            language === 'zh' ? '处理图片失败' : 'Failed to process image'
          );
          continue;
        }
      }

      if (newImages.length === 0) {
        event.target.value = '';
        return;
      }

      // Add files to asset library (async, don't block UI)
      newImages.forEach(({ file, name }) => {
        addAsset(file as File, AssetType.IMAGE, AssetSource.LOCAL, name).catch(
          (err) => {
            console.warn('[ImageUpload] Failed to add asset to library:', err);
          }
        );
      });

      if (multiple) {
        onImagesChange([...images, ...newImages] as any);
      } else {
        onImagesChange(newImages.slice(0, 1) as any);
      }

      if (newImages.length !== sizeValidFiles.length) {
        onError?.(
          language === 'zh'
            ? '部分文件格式不支持或超过25MB限制'
            : 'Some files are not supported or exceed 25MB limit'
        );
      } else {
        onError?.(null);
      }
    }
    event.target.value = '';
  };

  const removeImage = (index: number) => {
    onImagesChange(images.filter((_, i) => i !== index));
  };

  // 创建并缓存图片预览 URL（防止渲染时重复创建导致内存泄漏）
  const imageSrcMap = useMemo(() => {
    const map = new Map<number, string>();
    images.forEach((image, index) => {
      if (image.file) {
        map.set(index, URL.createObjectURL(image.file));
      } else if (image.url) {
        map.set(index, image.url);
      }
    });
    return map;
  }, [images]);

  // 清理 Blob URL 防止内存泄漏
  useEffect(() => {
    return () => {
      imageSrcMap.forEach((url, index) => {
        // 只 revoke 由 File 创建的 Blob URL
        if (images[index]?.file) {
          URL.revokeObjectURL(url);
        }
      });
    };
  }, [imageSrcMap, images]);

  const getImageSrc = (index: number) => {
    return imageSrcMap.get(index) || '';
  };

  const assetToImageFile = async (asset: Asset): Promise<ImageFile> => {
    if (asset.size && asset.size > MAX_IMAGE_SIZE_BYTES) {
      throw new Error(`Asset exceeds 25MB limit: ${asset.name}`);
    }

    const runtimeUrl = getAssetRuntimeUrl(asset);
    if (isTauriEnvironment()) {
      return {
        url: runtimeUrl,
        name: asset.name,
      };
    }

    const response = await fetch(runtimeUrl);
    let blob = await response.blob();

    if (blob.size > MAX_IMAGE_SIZE_BYTES) {
      throw new Error(`Asset exceeds 25MB limit: ${asset.name}`);
    }

    if (blob.size > COMPRESSION_THRESHOLD_BYTES) {
      const { compressImageBlob, getCompressionStrategy } = await import(
        '@aitu/utils'
      );
      const strategy = getCompressionStrategy(blob.size / (1024 * 1024));
      blob = await compressImageBlob(blob, strategy.targetSizeMB);
    }

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    return {
      url: dataUrl,
      name: asset.name,
    };
  };

  const handleMediaLibrarySelect = async (asset: Asset) => {
    try {
      const newImage = await assetToImageFile(asset);

      if (multiple) {
        onImagesChange([...images, newImage]);
      } else {
        onImagesChange([newImage]);
      }

      setShowMediaLibrary(false);
      onError?.(null);
    } catch (error) {
      console.error('[ImageUpload] Failed to convert asset to base64:', error);
      onError?.(language === 'zh' ? '加载图片失败' : 'Failed to load image');
      setShowMediaLibrary(false);
    }
  };

  const handleDesktopLocalSelect = async (
    mode: 'append' | 'replace',
    replaceIndex?: number
  ) => {
    if (!isTauriEnvironment()) return false;

    try {
      const pickedFiles = await assetStorageService.pickDesktopMediaFiles();
      const imageFiles = pickedFiles.filter(
        (file) =>
          file.fileType === 'image' || file.mimeType.startsWith('image/')
      );
      const selectedFiles = multiple ? imageFiles : imageFiles.slice(0, 1);
      if (selectedFiles.length === 0) {
        return true;
      }

      const nextImages: ImageFile[] = [];
      for (const file of selectedFiles) {
        if (file.size > MAX_IMAGE_SIZE_BYTES) {
          onError?.(
            language === 'zh'
              ? `图片 "${file.name}" 超过25MB限制`
              : `Image "${file.name}" exceeds 25MB limit`
          );
          continue;
        }

        const asset = await assetStorageService.addDesktopLocalAssetFromPath({
          path: file.path,
          type: AssetType.IMAGE,
          name: file.name,
          mimeType: file.mimeType,
        });
        nextImages.push({
          url: getAssetRuntimeUrl(asset),
          name: asset.name,
        });
      }

      if (nextImages.length === 0) {
        return true;
      }

      if (mode === 'replace' && replaceIndex !== undefined) {
        const updated = [...images];
        updated[replaceIndex] = nextImages[0];
        onImagesChange(updated);
      } else if (multiple) {
        onImagesChange([...images, ...nextImages]);
      } else {
        onImagesChange([nextImages[0]]);
      }
      onError?.(null);
      return true;
    } catch (error) {
      console.error('[ImageUpload] Desktop local selection failed:', error);
      onError?.(
        language === 'zh' ? '本地图片导入失败' : 'Failed to import local images'
      );
      return true;
    }
  };

  const openLocalFilePicker = async (
    input: HTMLInputElement | null,
    mode: 'append' | 'replace' = 'append',
    replaceIndex?: number
  ) => {
    const handled = await handleDesktopLocalSelect(mode, replaceIndex);
    if (!handled) {
      input?.click();
    }
  };

  const handleMediaLibrarySelectMultiple = async (assets: Asset[]) => {
    if (assets.length === 0) return;

    try {
      const selectedAssets = assets.slice(0, MAX_MEDIA_LIBRARY_BATCH_COUNT);
      const newImages: ImageFile[] = [];

      if (assets.length > MAX_MEDIA_LIBRARY_BATCH_COUNT) {
        MessagePlugin.warning({
          content:
            language === 'zh'
              ? `最多可批量使用 ${MAX_MEDIA_LIBRARY_BATCH_COUNT} 张图片，已自动截取`
              : `Up to ${MAX_MEDIA_LIBRARY_BATCH_COUNT} images can be used at once`,
          duration: 3,
        });
      }

      for (const asset of selectedAssets) {
        try {
          newImages.push(await assetToImageFile(asset));
        } catch (err) {
          console.error(
            '[ImageUpload] Failed to convert asset:',
            asset.name,
            err
          );
        }
      }

      if (newImages.length === 0) {
        onError?.(language === 'zh' ? '加载图片失败' : 'Failed to load image');
        setShowMediaLibrary(false);
        return;
      }

      if (multiple) {
        onImagesChange([...images, ...newImages]);
      } else {
        onImagesChange(newImages.slice(0, 1));
      }

      setShowMediaLibrary(false);
      onError?.(null);
    } catch (error) {
      console.error('[ImageUpload] Failed to batch convert assets:', error);
      onError?.(language === 'zh' ? '加载图片失败' : 'Failed to load image');
      setShowMediaLibrary(false);
    }
  };

  const defaultLabel =
    language === 'zh'
      ? `${multiple ? '参考图片' : '源图片'} (可选)`
      : `${multiple ? 'Reference Images' : 'Source Image'} (Optional)`;

  return (
    <div className="form-field">
      <div className="form-label-row">
        <label className="form-label">{label || defaultLabel}</label>
        {headerRight && <div className="form-label-right">{headerRight}</div>}
      </div>
      <div className="unified-image-area">
        <div className="images-grid">
          {images.length === 0 ? (
            <div className="add-more-item">
              <input
                ref={fileInputRef}
                type="file"
                id="image-upload"
                multiple={multiple}
                accept="image/*"
                onChange={handleImageUpload}
                className="upload-input"
                disabled={disabled}
                style={{ display: 'none' }}
              />
              <div className="add-more-buttons">
                <Button
                  variant="outline"
                  icon={<ImageUploadIcon size={18} />}
                  onClick={() => openLocalFilePicker(fileInputRef.current)}
                  disabled={disabled}
                  data-track="image_upload_select_from_local"
                  className="add-more-btn"
                >
                  {language === 'zh' ? '本地' : 'Local'}
                </Button>
                <Button
                  variant="outline"
                  icon={<MediaLibraryIcon size={18} />}
                  onClick={() => setShowMediaLibrary(true)}
                  disabled={disabled}
                  data-track="image_upload_select_from_library"
                  className="add-more-btn"
                >
                  {language === 'zh' ? '素材库' : 'Library'}
                </Button>
              </div>
            </div>
          ) : (
            <>
              {images.map((image, index) => {
                const src = getImageSrc(index);
                return (
                  <div key={index} className="uploaded-image-item">
                    <HoverCard
                      content={<img src={src} alt="Large preview" />}
                      placement="top"
                      sideOffset={12}
                      contentClassName="image-hover-tooltip"
                      contentStyle={{ zIndex: Z_INDEX.DIALOG_POPOVER }}
                    >
                      <div className="uploaded-image-preview-container">
                        <img
                          src={src}
                          alt={`Upload ${index + 1}`}
                          className="uploaded-image-preview"
                        />
                      </div>
                    </HoverCard>
                    <button
                      type="button"
                      data-track="ai_click_image_remove"
                      onClick={() => removeImage(index)}
                      className="remove-image-btn"
                      disabled={disabled}
                    >
                      ×
                    </button>
                    <div className="image-info">
                      <span className="image-name">{image.name}</span>
                    </div>
                  </div>
                );
              })}
              {multiple && (
                <div className="add-more-item">
                  <input
                    ref={moreFileInputRef}
                    type="file"
                    id="image-upload-more"
                    multiple
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="upload-input"
                    disabled={disabled}
                    style={{ display: 'none' }}
                  />
                  <div className="add-more-buttons">
                    <Button
                      variant="outline"
                      icon={<ImageUploadIcon size={18} />}
                      onClick={() =>
                        openLocalFilePicker(moreFileInputRef.current)
                      }
                      disabled={disabled}
                      data-track="image_upload_select_from_local_more"
                      className="add-more-btn"
                    >
                      {language === 'zh' ? '本地' : 'Local'}
                    </Button>
                    <Button
                      variant="outline"
                      icon={<MediaLibraryIcon size={18} />}
                      onClick={() => setShowMediaLibrary(true)}
                      disabled={disabled}
                      data-track="image_upload_select_from_library_more"
                      className="add-more-btn"
                    >
                      {language === 'zh' ? '素材库' : 'Library'}
                    </Button>
                  </div>
                </div>
              )}
              {!multiple && (
                <div className="add-more-item">
                  <input
                    ref={replaceFileInputRef}
                    type="file"
                    id="image-replace"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="upload-input"
                    disabled={disabled}
                    style={{ display: 'none' }}
                  />
                  <div className="add-more-buttons">
                    <Button
                      variant="outline"
                      icon={<ImageUploadIcon size={18} />}
                      onClick={() =>
                        openLocalFilePicker(
                          replaceFileInputRef.current,
                          'replace',
                          0
                        )
                      }
                      disabled={disabled}
                      data-track="image_upload_replace_from_local"
                      className="add-more-btn"
                    >
                      {language === 'zh' ? '本地' : 'Local'}
                    </Button>
                    <Button
                      variant="outline"
                      icon={<MediaLibraryIcon size={18} />}
                      onClick={() => setShowMediaLibrary(true)}
                      disabled={disabled}
                      data-track="image_upload_replace_from_library"
                      className="add-more-btn"
                    >
                      {language === 'zh' ? '素材库' : 'Library'}
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Media Library Modal */}
      {showMediaLibrary && (
        <MediaLibraryModal
          isOpen={showMediaLibrary}
          onClose={() => setShowMediaLibrary(false)}
          mode={SelectionMode.SELECT}
          filterType={AssetType.IMAGE}
          onSelect={handleMediaLibrarySelect}
          onSelectMultiple={
            multiple ? handleMediaLibrarySelectMultiple : undefined
          }
          batchSelectButtonText={multiple ? '批量插入对话框' : undefined}
        />
      )}
    </div>
  );
};
