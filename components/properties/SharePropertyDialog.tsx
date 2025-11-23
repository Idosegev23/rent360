'use client';

import { useState, useEffect } from 'react';
import { X, Copy, Check, Eye, Clock, Share2, ExternalLink } from 'lucide-react';

interface ShareData {
  share: {
    id: string;
    token: string;
    view_count: number;
    last_viewed_at: string | null;
    created_at: string;
  } | null;
  url: string;
}

interface SharePropertyDialogProps {
  propertyId: string;
  propertyTitle: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function SharePropertyDialog({
  propertyId,
  propertyTitle,
  isOpen,
  onClose,
}: SharePropertyDialogProps) {
  const [shareData, setShareData] = useState<ShareData | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchOrCreateShare();
    }
  }, [isOpen, propertyId]);

  const fetchOrCreateShare = async () => {
    setLoading(true);
    setError(null);
    try {
      // Try to get existing share first
      const getResponse = await fetch(`/api/v1/properties/${propertyId}/share`);
      
      if (getResponse.ok) {
        const data = await getResponse.json();
        if (data.share) {
          setShareData(data);
          return;
        }
      }

      // Create new share if doesn't exist
      const createResponse = await fetch(`/api/v1/properties/${propertyId}/share`, {
        method: 'POST',
      });

      if (!createResponse.ok) {
        throw new Error('שגיאה ביצירת קישור שיתוף');
      }

      const data = await createResponse.json();
      setShareData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה לא ידועה');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!shareData?.url) return;
    
    try {
      await navigator.clipboard.writeText(shareData.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleOpenInNewTab = () => {
    if (shareData?.url) {
      window.open(shareData.url, '_blank');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Share2 className="h-5 w-5 text-orange-500" />
            <h2 className="text-lg font-bold text-gray-900">שיתוף נכס</h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {loading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500 mx-auto mb-4"></div>
              <p className="text-gray-600">יוצר קישור שיתוף...</p>
            </div>
          ) : error ? (
            <div className="text-center py-8">
              <p className="text-red-600">{error}</p>
              <button
                onClick={fetchOrCreateShare}
                className="mt-4 text-orange-500 hover:text-orange-600 font-medium"
              >
                נסה שוב
              </button>
            </div>
          ) : shareData ? (
            <>
              {/* Property Info */}
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm text-gray-600 mb-1">נכס לשיתוף:</p>
                <p className="font-semibold text-gray-900">{propertyTitle}</p>
              </div>

              {/* Share Link */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  קישור לשיתוף
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={shareData.url}
                    readOnly
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-900 text-sm font-mono"
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <button
                    onClick={handleCopy}
                    className={`px-4 py-2 rounded-lg font-medium transition-all flex items-center gap-2 ${
                      copied
                        ? 'bg-green-500 text-white'
                        : 'bg-orange-500 hover:bg-orange-600 text-white'
                    }`}
                  >
                    {copied ? (
                      <>
                        <Check className="h-4 w-4" />
                        הועתק
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4" />
                        העתק
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Open in new tab button */}
              <button
                onClick={handleOpenInNewTab}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors flex items-center justify-center gap-2 text-gray-700"
              >
                <ExternalLink className="h-4 w-4" />
                <span>פתח בטאב חדש</span>
              </button>

              {/* Statistics */}
              {shareData.share && (
                <div className="border-t border-gray-200 pt-6">
                  <h3 className="text-sm font-semibold text-gray-900 mb-4">
                    סטטיסטיקות שיתוף
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-blue-50 rounded-lg p-4">
                      <div className="flex items-center gap-2 text-blue-600 mb-1">
                        <Eye className="h-4 w-4" />
                        <span className="text-sm font-medium">צפיות</span>
                      </div>
                      <p className="text-2xl font-bold text-blue-900">
                        {shareData.share.view_count}
                      </p>
                    </div>
                    <div className="bg-purple-50 rounded-lg p-4">
                      <div className="flex items-center gap-2 text-purple-600 mb-1">
                        <Clock className="h-4 w-4" />
                        <span className="text-sm font-medium">צפייה אחרונה</span>
                      </div>
                      <p className="text-sm font-semibold text-purple-900">
                        {shareData.share.last_viewed_at
                          ? new Date(shareData.share.last_viewed_at).toLocaleDateString('he-IL')
                          : 'עדיין לא נצפה'}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 text-xs text-gray-500 text-center">
                    נוצר ב-{new Date(shareData.share.created_at).toLocaleDateString('he-IL')}
                  </div>
                </div>
              )}

              {/* Info */}
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                <p className="text-sm text-orange-800">
                  <strong>שים לב:</strong> הקישור לא מכיל פרטי התקשרות או מיקום מדויק של הנכס.
                  הלקוח יוכל לראות את הפרטים הבסיסיים ולפנות אליך דרך WhatsApp.
                </p>
              </div>
            </>
          ) : null}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 bg-gray-900 hover:bg-gray-800 text-white font-medium rounded-lg transition-colors"
          >
            סגור
          </button>
        </div>
      </div>
    </div>
  );
}

