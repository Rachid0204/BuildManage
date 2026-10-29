import Form from '../common/Form';
import { useToast } from '../common/Toast';
import React, { useState, useMemo, useRef, useId } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Building, MarketplaceItem, MarketplaceCategory, MarketplaceListingType, MarketplaceCondition, ChatMessage } from '../../types';
import Card from '../common/Card';
import Button from '../common/Button';
import Modal from '../common/Modal';
import {
  MarketplaceIcon,
  PlusIcon,
  PhoneIcon,
  WhatsAppIcon,
  TrashIcon,
} from '../icons/IconComponents';
import {
  getMarketplaceItems,
  addMarketplaceItem,
  updateMarketplaceItemStatus,
  deleteMarketplaceItem,
  getChatMessages,
  sendChatMessage,
} from '../../firebase/services';
import Loading from '../common/Loading';
import { useI18n } from '../../hooks/useI18n';

interface MarketplaceViewProps {
  building: Building;
  currentResidentId?: string;
  currentResidentName?: string;
  currentApartmentNumber?: string;
  currentPhone?: string;
  isResidentPortal?: boolean;
}

const CATEGORIES: { id: MarketplaceCategory; labelFr: string; labelAr: string; icon: string }[] = [
  { id: 'furniture', labelFr: 'Meubles & Déco', labelAr: 'أثاث وديكور', icon: '🛋️' },
  { id: 'appliances', labelFr: 'Électroménager', labelAr: 'أجهزة كهرومنزلية', icon: '🔌' },
  { id: 'kids', labelFr: 'Enfants & Jouets', labelAr: 'أطفال وألعاب', icon: '🧸' },
  { id: 'bricolage', labelFr: 'Bricolage & Jardin', labelAr: 'أدوات وحديقة', icon: '🔨' },
  { id: 'services', labelFr: 'Entraide & Services', labelAr: 'تعاون وخدمات', icon: '🤝' },
  { id: 'electronics', labelFr: 'High-Tech & TV', labelAr: 'إلكترونيات وتلفاز', icon: '💻' },
  { id: 'other', labelFr: 'Autre', labelAr: 'أخرى', icon: '📦' },
];

const SAMPLE_IMAGES = [
  { labelFr: 'Mobilier & Salon', labelAr: 'أثاث وصالون', url: 'https://images.unsplash.com/photo-1533090161767-e6ffed986c88?w=800&auto=format&fit=crop&q=80' },
  { labelFr: 'Électroménager / Cuisine', labelAr: 'كهرومنزلي / مطبخ', url: 'https://images.unsplash.com/photo-1517668808822-9ebb02f2a0e6?w=800&auto=format&fit=crop&q=80' },
  { labelFr: 'Livres / Culture', labelAr: 'كتب / ثقافة', url: 'https://images.unsplash.com/photo-1512820790803-83ca734da794?w=800&auto=format&fit=crop&q=80' },
  { labelFr: 'Enfants / Vélo', labelAr: 'أطفال / دراجة', url: 'https://images.unsplash.com/photo-1485965120184-e220f721d03e?w=800&auto=format&fit=crop&q=80' },
  { labelFr: 'Covoiturage / Transport', labelAr: 'نقل مشترك', url: 'https://images.unsplash.com/photo-1449965408869-eaa3f722e40d?w=800&auto=format&fit=crop&q=80' },
  { labelFr: 'Bricolage / Outils', labelAr: 'معدات وأدوات', url: 'https://images.unsplash.com/photo-1581783342308-f792dbdd27c5?w=800&auto=format&fit=crop&q=80' },
];

const currencyFormatter = new Intl.NumberFormat('fr-MA', {
  style: 'currency',
  currency: 'MAD',
  maximumFractionDigits: 0,
});

// Helper to compress uploaded images via HTML Canvas to crisp Data URLs (~120-180KB each)
const compressImageFile = (file: File, maxWidth = 1200, maxHeight = 1200, quality = 0.82): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxWidth || height > maxHeight) {
          if (width / height > maxWidth / maxHeight) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(event.target?.result as string);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(compressedDataUrl);
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
};

interface MarketplaceCardProps {
  item: MarketplaceItem;
  currentResidentId: string;
  currentApartmentNumber: string;
  messageCount: number;
  onOpenDetails: (item: MarketplaceItem, initialIndex?: number) => void;
  onOpenChat: (item: MarketplaceItem) => void;
  onUpdateStatus: (id: string, status: MarketplaceItem['status']) => void;
  onDelete: (id: string) => void;
}

const MarketplaceCard: React.FC<MarketplaceCardProps> = ({
  item,
  currentResidentId,
  currentApartmentNumber,
  messageCount,
  onOpenDetails,
  onOpenChat,
  onUpdateStatus,
  onDelete,
}) => {
  const { tr } = useI18n();
  const isOwner = item.residentId === currentResidentId;
  const isSold = item.status === 'sold';
  const isReserved = item.status === 'reserved';

  const itemPhotos = useMemo(() => {
    if (item.images && item.images.length > 0) return item.images;
    if (item.imageUrl) return [item.imageUrl];
    return [SAMPLE_IMAGES[0].url];
  }, [item.images, item.imageUrl]);

  const [cardPhotoIndex, setCardPhotoIndex] = useState(0);

  const cleanPhone = (item.whatsapp || item.phone || '').replace(/\s+/g, '').replace('+', '');
  const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(
    tr(
      `Salam ${item.residentName}, je suis votre voisin (${currentApartmentNumber}). Je vous contacte au sujet de votre annonce sur le Souk : "${item.title}". Est-ce toujours disponible ?`,
      `السلام عليكم ${item.residentName}، أنا جارك (${currentApartmentNumber}). أتواصل معك بخصوص إعلانك في سوق الجيران: "${item.title}". هل لا يزال متوفراً؟`
    )
  )}`;

  const handleNextPhoto = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCardPhotoIndex((prev) => (prev + 1) % itemPhotos.length);
  };

  const handlePrevPhoto = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCardPhotoIndex((prev) => (prev - 1 + itemPhotos.length) % itemPhotos.length);
  };

  return (
    <Card
      className={`group flex flex-col justify-between overflow-hidden border border-slate-200 hover:shadow-xl transition-all duration-300 rounded-2xl bg-white ${
        isSold ? 'opacity-65' : ''
      }`}
    >
      <div>
        {/* Image Banner with Badges & Multi-Photo Carousel */}
        <div
          onClick={() => onOpenDetails(item, cardPhotoIndex)}
          className="relative h-48 w-full bg-slate-100 overflow-hidden cursor-pointer select-none"
        >
          <img
            src={itemPhotos[cardPhotoIndex]}
            alt={item.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />

          <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/20 pointer-events-none" />

          {/* Top Badges */}
          <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 flex-wrap z-10">
            {item.type === 'free' ? (
              <span className="bg-emerald-600 text-white font-bold text-[10px] uppercase tracking-wider px-2.5 py-0.5 rounded-full shadow-sm">
                🎁 {tr('Don Gratuit', 'تبرع مجاني')}
              </span>
            ) : item.type === 'service' ? (
              <span className="bg-indigo-600 text-white font-bold text-[10px] uppercase tracking-wider px-2.5 py-0.5 rounded-full shadow-sm">
                🤝 {tr('Service', 'خدمة')}
              </span>
            ) : (
              <span className="bg-blue-600 text-white font-bold text-[10px] uppercase tracking-wider px-2.5 py-0.5 rounded-full shadow-sm">
                🏷️ {tr('À Vendre', 'للبيع')}
              </span>
            )}

            {item.condition && (
              <span className="bg-black/60 backdrop-blur-sm text-white font-medium text-[10px] px-2 py-0.5 rounded-full">
                {item.condition === 'new'
                  ? tr('Neuf', 'جديد')
                  : item.condition === 'like_new'
                  ? tr('Comme neuf', 'شبه جديد')
                  : item.condition === 'good'
                  ? tr('Bon état', 'حالة جيدة')
                  : tr("État d'usage", 'مستعمل')}
              </span>
            )}
          </div>

          {/* Photo Counter Badge */}
          {itemPhotos.length > 1 && (
            <div className="absolute top-2.5 right-2.5 bg-black/60 backdrop-blur-sm text-white font-mono text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 z-10">
              <span>📷</span>
              <span>
                {cardPhotoIndex + 1}/{itemPhotos.length}
              </span>
            </div>
          )}

          {/* Carousel Arrows on Card */}
          {itemPhotos.length > 1 && (
            <>
              <button
                type="button"
                onClick={handlePrevPhoto}
                className="absolute left-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/40 hover:bg-black/70 text-white flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity z-10"
                title={tr('Photo précédente', 'الصورة السابقة')}
              >
                ‹
              </button>
              <button
                type="button"
                onClick={handleNextPhoto}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/40 hover:bg-black/70 text-white flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity z-10"
                title={tr('Photo suivante', 'الصورة التالية')}
              >
                ›
              </button>

              <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 flex items-center gap-1 z-10">
                {itemPhotos.map((_, i) => (
                  <span
                    key={i}
                    className={`h-1.5 rounded-full transition-all ${
                      i === cardPhotoIndex ? 'w-4 bg-white' : 'w-1.5 bg-white/50'
                    }`}
                  />
                ))}
              </div>
            </>
          )}

          {/* Overlay Status */}
          {isSold && (
            <div className="absolute inset-0 bg-slate-900/65 backdrop-blur-[2px] flex items-center justify-center z-20">
              <span className="text-white font-bold text-xs uppercase tracking-wider px-3 py-1 bg-rose-600 rounded-lg shadow-md">
                {tr('Vendu / Clôturé', 'تم البيع / مغلق')}
              </span>
            </div>
          )}
          {isReserved && !isSold && (
            <div className="absolute inset-0 bg-amber-900/40 backdrop-blur-[1px] flex items-center justify-center z-20">
              <span className="text-white font-bold text-xs uppercase tracking-wider px-3 py-1 bg-amber-600 rounded-lg shadow-md">
                {tr('Réservé', 'محجوز')}
              </span>
            </div>
          )}

          {/* Price Tag in Bottom Right */}
          <div className="absolute bottom-2.5 right-2.5 z-10">
            <span className="bg-white/95 text-slate-900 font-mono font-bold text-sm px-2.5 py-1 rounded-lg shadow-sm border border-slate-200">
              {item.type === 'free' ? tr('0 DH (Don)', '0 درهم (مجاني)') : currencyFormatter.format(item.price)}
            </span>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 space-y-2">
          <div
            onClick={() => onOpenDetails(item, cardPhotoIndex)}
            className="cursor-pointer"
          >
            <h3 className="font-bold text-slate-900 text-sm leading-snug line-clamp-1 group-hover:text-teal-700 transition-colors">
              {item.title}
            </h3>
            <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed mt-1">
              {item.description}
            </p>
          </div>

          {/* Seller Info Strip */}
          <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
            <span className="font-semibold text-slate-800 flex items-center gap-1">
              <span>👤</span>
              <span>{item.residentName}</span>
            </span>
            <span className="font-mono bg-slate-100 px-2 py-0.5 rounded text-[11px] font-semibold text-slate-700">
              {item.apartmentNumber}
            </span>
          </div>
        </div>
      </div>

      {/* Bottom Actions */}
      <div className="p-4 pt-0 space-y-2">
        {!isSold ? (
          <div className="space-y-2">
            {/* Primary In-Platform Chat Button */}
            <button
              type="button"
              onClick={() => onOpenChat(item)}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-bold text-xs transition-all shadow-xs"
            >
              <span>💬</span>
              <span>{isOwner ? tr('Voir les messages reçus', 'عرض الرسائل الواردة') : tr('Discuter sur la plateforme', 'المحادثة عبر المنصة')}</span>
              {messageCount > 0 && (
                <span className="bg-amber-400 text-slate-950 font-mono text-[10px] font-extrabold px-1.5 py-0.5 rounded-full">
                  {messageCount}
                </span>
              )}
            </button>

            <div className="grid grid-cols-2 gap-2">
              <a
                href={waUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 font-bold text-xs transition-colors"
              >
                <WhatsAppIcon />
                <span>WhatsApp</span>
              </a>
              <button
                type="button"
                onClick={() => onOpenDetails(item, cardPhotoIndex)}
                className="flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs transition-colors"
              >
                <span>🔍 {tr('Photos', 'الصور')} ({itemPhotos.length})</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between text-xs text-slate-400 py-1">
            <span>{tr('Cette annonce est clôturée.', 'هذا الإعلان مغلق.')}</span>
            <div className="flex items-center gap-2">
              {messageCount > 0 && (
                <button
                  type="button"
                  onClick={() => onOpenChat(item)}
                  className="text-xs text-teal-700 font-semibold hover:underline"
                >
                  💬 {tr('Historique', 'السجل')} ({messageCount})
                </button>
              )}
              <button
                onClick={() => onOpenDetails(item, cardPhotoIndex)}
                className="text-xs text-slate-600 underline"
              >
                {tr('Voir détails', 'التفاصيل')}
              </button>
            </div>
          </div>
        )}

        {/* Owner Controls */}
        {isOwner && (
          <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
            {!isSold ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onUpdateStatus(item.id, isReserved ? 'available' : 'reserved')}
                  className="text-amber-700 hover:text-amber-900 font-semibold"
                >
                  {isReserved ? tr('Rendre disponible', 'إعادة العرض') : tr('Marquer réservé', 'تحديد كمحجوز')}
                </button>
                <span>·</span>
                <button
                  onClick={() => onUpdateStatus(item.id, 'sold')}
                  className="text-slate-600 hover:text-rose-700 font-semibold"
                >
                  {tr('Marquer vendu', 'تحديد كمباع')}
                </button>
              </div>
            ) : (
              <button
                onClick={() => onUpdateStatus(item.id, 'available')}
                className="text-teal-700 hover:text-teal-900 font-semibold"
              >
                {tr('Remettre en vente', 'إعادة العرض للبيع')}
              </button>
            )}

            <button
              onClick={() => {
                if (confirm(tr('Voulez-vous vraiment supprimer cette annonce ?', 'هل تريد حقاً حذف هذا الإعلان؟'))) {
                  onDelete(item.id);
                }
              }}
              className="text-rose-500 hover:text-rose-700 p-1"
              title={tr("Supprimer l'annonce", 'حذف الإعلان')}
            >
              <TrashIcon />
            </button>
          </div>
        )}
      </div>
    </Card>
  );
};

export const MarketplaceView: React.FC<MarketplaceViewProps> = ({
  building,
  currentResidentId = 'res-2',
  currentResidentName = 'Fatima Zahra Mansouri',
  currentApartmentNumber = 'Lot A-102',
  currentPhone = '0661 22 33 44',
  isResidentPortal = false,
}) => {
  const { tr, isAr } = useI18n();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const publishFormId = useId();
  const { showToast } = useToast();

  const [activeTypeTab, setActiveTypeTab] = useState<'all' | 'sale' | 'free' | 'service'>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);

  // Detail / Lightbox Modal State
  const [activeDetailItem, setActiveDetailItem] = useState<MarketplaceItem | null>(null);
  const [detailPhotoIndex, setDetailPhotoIndex] = useState(0);

  // In-Platform Marketplace Chat State
  const [activeBuyer, setActiveBuyer] = useState('');
  const [activeChatListing, setActiveChatListing] = useState<MarketplaceItem | null>(null);
  const [isInboxOpen, setIsInboxOpen] = useState(false);
  const [chatInputText, setChatInputText] = useState('');
  const chatBottomRef = useRef<HTMLDivElement | null>(null);

  // Form State
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<MarketplaceCategory>('furniture');
  const [listingType, setListingType] = useState<MarketplaceListingType>('sale');
  const [price, setPrice] = useState<number | ''>(200);
  const [condition, setCondition] = useState<MarketplaceCondition>('good');
  const [sellerPhone, setSellerPhone] = useState(currentPhone);

  // Photo Upload State
  const [uploadedPhotos, setUploadedPhotos] = useState<string[]>([]);
  const [isCompressing, setIsCompressing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showSamplePicker, setShowSamplePicker] = useState(false);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['marketplaceItems', building.id],
    queryFn: () => getMarketplaceItems(building.id),
  });

  // Fetch all marketplace chat messages for this building
  const { data: allMarketplaceMessages = [] } = useQuery({
    queryKey: ['chatMessages', building.id, 'marketplace'],
    queryFn: () => getChatMessages(building.id, 'marketplace'),
    refetchInterval: 4000,
  });

  const sendChatMutation = useMutation({
    mutationFn: (content: string) => {
      if (!activeChatListing) throw new Error(tr('Aucune annonce sélectionnée', 'لم يتم تحديد أي إعلان'));
      const isSeller = activeChatListing.residentId === currentResidentId;
      if (isSeller && !activeBuyer) throw new Error(tr('Sélectionnez un acheteur.','اختر مشترياً.'));
      const payload: Omit<ChatMessage, 'id' | 'createdAt'> = {
        buildingId: building.id,
        channelId: `market-${activeChatListing.id}`,
        senderId: currentResidentId,
        senderName: currentResidentName,
        senderRole: isResidentPortal ? 'resident' : 'syndic',
        senderApartment: currentApartmentNumber,
        recipientId: isSeller ? activeBuyer : activeChatListing.residentId,
        recipientName: activeChatListing.residentName,
        content,
        badge: isSeller ? tr('Réponse Vendeur', 'رد البائع') : tr('Question Souk', 'سؤال في السوق'),
        marketplaceItemId: activeChatListing.id,
        marketplaceItemTitle: activeChatListing.title,
        marketplaceItemPrice: activeChatListing.price,
        marketplaceItemImage:
          (activeChatListing.images && activeChatListing.images[0]) || activeChatListing.imageUrl,
      };
      return sendChatMessage(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chatMessages', building.id] });
      setChatInputText('');
      setTimeout(() => {
        chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    },
  });

  const handleOpenChatForItem = (item: MarketplaceItem) => {
    setActiveChatListing(item);
    setChatInputText('');
  };

  const handleSendMarketplaceChat = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = chatInputText.trim();
    if (!trimmed || !activeChatListing) return;
    sendChatMutation.mutate(trimmed);
  };

  // Count messages per item
  const messageCountByItemId = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const msg of allMarketplaceMessages) {
      const itemId =
        msg.marketplaceItemId ||
        (msg.channelId.startsWith('market-') ? msg.channelId.replace('market-', '') : '');
      if (itemId) {
        counts[itemId] = (counts[itemId] || 0) + 1;
      }
    }
    return counts;
  }, [allMarketplaceMessages]);

  // Active item conversation messages
  const activeItemMessages = useMemo(() => {
    if (!activeChatListing || (activeChatListing.residentId === currentResidentId && !activeBuyer)) return [];
    return allMarketplaceMessages.filter(
      (m) =>
        (activeChatListing.residentId !== currentResidentId || m.senderId === activeBuyer || m.recipientId === activeBuyer) && (m.channelId === `market-${activeChatListing.id}` ||
        m.marketplaceItemId === activeChatListing.id)
    );
  }, [allMarketplaceMessages, activeChatListing, activeBuyer, currentResidentId]);

  const publishMutation = useMutation({
    mutationFn: addMarketplaceItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['marketplaceItems', building.id] });
      setIsPublishModalOpen(false);
      resetForm();

    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: MarketplaceItem['status'] }) =>
      updateMarketplaceItemStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['marketplaceItems', building.id] });
      if (activeDetailItem) {
        queryClient.invalidateQueries({ queryKey: ['marketplaceItems', building.id] });
        setActiveDetailItem(null);
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteMarketplaceItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['marketplaceItems', building.id] });
      if (activeDetailItem) {
        setActiveDetailItem(null);
      }
    },
  });

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setCategory('furniture');
    setListingType('sale');
    setPrice(200);
    setCondition('good');
    setUploadedPhotos([]);
    setShowSamplePicker(false);
  };

  // Image upload handler
  const handleFilesSelected = async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0 || fileArray.some(file => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024 || !file.size)) {
      showToast(tr('Choisissez des photos JPG, PNG ou WebP de 5 Mo maximum chacune.', 'اختر صور JPG أو PNG أو WebP بحجم أقصى 5 ميغابايت لكل صورة.'), 'error');
      return;
    }

    if (uploadedPhotos.length + fileArray.length > 5) {
      showToast(tr('Vous pouvez télécharger un maximum de 5 photos par annonce.', 'يمكنك تحميل 5 صور كحد أقصى لكل إعلان.'));
    }

    const availableSlots = Math.max(0, 5 - uploadedPhotos.length);
    const toProcess = fileArray.slice(0, availableSlots);

    setIsCompressing(true);
    try {
      const results = await Promise.all(toProcess.map((file) => compressImageFile(file)));
      setUploadedPhotos((prev) => [...prev, ...results]);
    } catch (err) {
      console.error('Erreur compression image:', err);
      showToast(tr("Une erreur s'est produite lors de la lecture des photos.", 'حدث خطأ أثناء قراءة الصور.'));
    } finally {
      setIsCompressing(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFilesSelected(e.dataTransfer.files);
    }
  };

  const handleRemovePhoto = (indexToRemove: number) => {
    setUploadedPhotos((prev) => prev.filter((_, idx) => idx !== indexToRemove));
  };

  const handleSetMainPhoto = (index: number) => {
    if (index === 0) return;
    setUploadedPhotos((prev) => {
      const copy = [...prev];
      const target = copy.splice(index, 1)[0];
      copy.unshift(target);
      return copy;
    });
  };

  const handleAddSampleImage = (url: string) => {
    if (uploadedPhotos.length >= 5) {
      return showToast(tr('Limite de 5 photos atteinte.', 'تم بلوغ الحد الأقصى (5 صور).'));
    }
    setUploadedPhotos((prev) => [...prev, url]);
  };

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !description.trim()) {
      throw new Error(tr('Le titre et la description sont obligatoires.', 'العنوان والوصف إجباريان.'));
    }

    const finalPrice = listingType === 'free' ? 0 : Number(price);
    if (!Number.isFinite(finalPrice) || finalPrice < 0 || (listingType === 'sale' && (price === '' || finalPrice <= 0)))
      throw new Error(tr('Indiquez un prix supérieur à zéro pour une vente, ou choisissez Don Gratuit.', 'أدخل سعراً أكبر من صفر للبيع، أو اختر تبرعاً مجانياً.'));
    if (!building.id || !currentResidentId) throw new Error(tr('Votre immeuble ou votre compte ne peut pas être identifié. Actualisez la page.', 'تعذر تحديد العمارة أو الحساب. حدّث الصفحة.'));
    const finalPhotos = uploadedPhotos.length > 0 ? uploadedPhotos : [SAMPLE_IMAGES[0].url];

    const payload: Omit<MarketplaceItem, 'id' | 'createdAt'> = {
      buildingId: building.id,
      residentId: currentResidentId,
      residentName: currentResidentName,
      apartmentNumber: currentApartmentNumber,
      phone: sellerPhone || currentPhone,
      whatsapp: (sellerPhone || currentPhone).replace(/\s+/g, '').replace('+', ''),
      title: title.trim(),
      description: description.trim(),
      category,
      type: listingType,
      price: finalPrice,
      condition,
      status: 'available',
      imageUrl: finalPhotos[0],
      images: finalPhotos,
    };

    return publishMutation.mutateAsync(payload);
  };

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (activeTypeTab !== 'all' && item.type !== activeTypeTab) return false;
      if (selectedCategory !== 'all' && item.category !== selectedCategory) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = item.title.toLowerCase().includes(q);
        const matchesDesc = item.description.toLowerCase().includes(q);
        const matchesSeller = (item.residentName || '').toLowerCase().includes(q);
        if (!matchesTitle && !matchesDesc && !matchesSeller) return false;
      }
      return true;
    });
  }, [items, activeTypeTab, selectedCategory, searchQuery]);

  const handleOpenDetails = (item: MarketplaceItem, initialIndex = 0) => {
    setActiveDetailItem(item);
    setDetailPhotoIndex(initialIndex);
  };

  if (isLoading) return <Loading message={tr('Chargement du Souk des Résidents...', 'جاري تحميل سوق الجيران...')} />;

  const modalPhotos = activeDetailItem
    ? activeDetailItem.images && activeDetailItem.images.length > 0
      ? activeDetailItem.images
      : activeDetailItem.imageUrl
      ? [activeDetailItem.imageUrl]
      : [SAMPLE_IMAGES[0].url]
    : [];

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <span className="p-1.5 bg-teal-100 text-teal-800 rounded-lg">
                <MarketplaceIcon />
              </span>
              <span>{tr('Le Souk des Résidents', 'سوق الجيران والساكنة')}</span>
            </h1>
            <span className="text-xs bg-emerald-100 text-emerald-800 font-semibold px-2.5 py-0.5 rounded-full">
              {tr('Petites Annonces & Économie Circulaire', 'إعلانات مبوبة وتبادل بين الجيران')}
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            {tr(
              `Achetez, vendez, donnez ou partagez des services entre voisins de la résidence ${building.name}.`,
              `اشترِ، بِع، تبرع أو تبادل الخدمات مع جيرانك في إقامة ${building.name}.`
            )}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setIsInboxOpen(true)}
            className="px-3.5 py-2 rounded-xl bg-white hover:bg-teal-50 text-teal-900 border border-teal-200 font-bold text-xs sm:text-sm flex items-center gap-2 shadow-xs transition-colors"
          >
            <span>💬</span>
            <span>{tr('Discussions Souk', 'محادثات السوق')}</span>
            <span className="bg-teal-700 text-white font-mono text-xs px-2 py-0.5 rounded-full">
              {allMarketplaceMessages.length}
            </span>
          </button>

          <Button
            onClick={() => {
              resetForm();
              setIsPublishModalOpen(true);
            }}
            className="text-xs sm:text-sm font-bold flex items-center gap-1.5 shadow-sm bg-teal-700 hover:bg-teal-800 text-white"
          >
            <PlusIcon />
            <span>{tr('Publier une annonce', 'نشر إعلان جديد')}</span>
          </Button>
        </div>
      </div>

      {/* Main Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-2">
        <div className="flex items-center gap-1 overflow-x-auto">
          {[
            { id: 'all', label: tr('Toutes les annonces', 'جميع الإعلانات') },
            { id: 'sale', label: tr('🏷️ À Vendre', '🏷️ للبيع') },
            { id: 'free', label: tr('🎁 Dons Gratuits', '🎁 تبرعات مجانية') },
            { id: 'service', label: tr('🤝 Entraide & Services', '🤝 تعاون وخدمات') },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTypeTab(tab.id as any)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
                activeTypeTab === tab.id
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-64">
          <input
            type="text"
            placeholder={tr('Rechercher meuble, vélo, don...', 'بحث: أثاث، دراجة، تبرع...')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full text-xs ps-8 pe-3 py-1.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
          <span className="absolute start-2.5 top-2 text-slate-400 text-xs">🔍</span>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute end-2 top-1.5 text-xs text-slate-400 hover:text-slate-600"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Category Filter Pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
        <button
          onClick={() => setSelectedCategory('all')}
          className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
            selectedCategory === 'all'
              ? 'bg-teal-700 text-white font-bold'
              : 'bg-white hover:bg-slate-100 text-slate-600 border border-slate-200'
          }`}
        >
          {tr('Toutes catégories', 'جميع الفئات')}
        </button>
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setSelectedCategory(cat.id)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap flex items-center gap-1 border ${
              selectedCategory === cat.id
                ? 'bg-teal-700 text-white font-bold border-teal-700 shadow-sm'
                : 'bg-white hover:bg-slate-100 text-slate-600 border-slate-200'
            }`}
          >
            <span>{cat.icon}</span>
            <span>{isAr ? cat.labelAr : cat.labelFr}</span>
          </button>
        ))}
      </div>

      {/* Listings Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredItems.map((item) => (
          <MarketplaceCard
            key={item.id}
            item={item}
            currentResidentId={currentResidentId}
            currentApartmentNumber={currentApartmentNumber}
            messageCount={messageCountByItemId[item.id] || 0}
            onOpenDetails={handleOpenDetails}
            onOpenChat={handleOpenChatForItem}
            onUpdateStatus={(id, status) => statusMutation.mutate({ id, status })}
            onDelete={(id) => deleteMutation.mutate(id)}
          />
        ))}

        {filteredItems.length === 0 && (
          <div className="col-span-full py-16 text-center bg-white rounded-2xl border border-dashed border-slate-300 p-8">
            <span className="text-4xl block mb-2">🛍️</span>
            <h3 className="font-bold text-slate-800 text-base">{tr('Aucune annonce trouvée', 'لم يتم العثور على أي إعلان')}</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              {tr(
                'Soyez le premier à publier un objet à vendre, à donner ou un service pour vos voisins !',
                'كن أول من ينشر غرضاً للبيع أو التبرع أو خدمة لجيرانك!'
              )}
            </p>
            <Button
              onClick={() => {
                resetForm();
                setIsPublishModalOpen(true);
              }}
              className="mt-4 text-xs font-bold bg-teal-700 hover:bg-teal-800"
            >
              {tr('+ Publier une annonce avec photos', '+ نشر إعلان مع صور')}
            </Button>
          </div>
        )}
      </div>

      {/* MODAL 1: PUBLISH NEW LISTING WITH PHOTO UPLOAD */}
      <Modal
        isOpen={isPublishModalOpen}
        busy={publishMutation.isPending || isCompressing}
        onClose={() => setIsPublishModalOpen(false)}
        title={tr('Publier une annonce sur le Souk des Résidents', 'نشر إعلان في سوق الجيران')}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setIsPublishModalOpen(false)}>
              {tr('Annuler', 'إلغاء')}
            </Button>
            <Button
              type="submit"
              form={publishFormId}
              disabled={publishMutation.isPending || isCompressing}
              className="bg-teal-700 hover:bg-teal-800 text-white font-bold"
            >
              {publishMutation.isPending ? tr('Publication en cours...', 'جاري النشر...') : tr('Publier mon annonce', 'نشر إعلاني')}
            </Button>
          </div>
        }
      >
        <Form id={publishFormId} onSubmit={handlePublish} className="space-y-4 text-xs sm:text-sm">
          {/* Listing Type Selection */}
          <div>
            <label className="block font-semibold text-slate-700 mb-1">{tr("Type d'annonce :", 'نوع الإعلان:')}</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'sale', label: tr('🏷️ À Vendre', '🏷️ للبيع') },
                { id: 'free', label: tr('🎁 Don Gratuit', '🎁 تبرع مجاني') },
                { id: 'service', label: tr('🤝 Service / Entraide', '🤝 خدمة / تعاون') },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setListingType(t.id as any);
                    if (t.id === 'free') setPrice(0);
                  }}
                  className={`py-2 px-3 rounded-lg font-bold text-xs border transition-all ${
                    listingType === t.id
                      ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Title & Category */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">{tr("Titre de l'annonce * :", 'عنوان الإعلان * :')}</label>
              <input
                type="text"
                required
                maxLength={200}
                aria-label={tr("Titre de l’annonce", "عنوان الإعلان")}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={tr('Ex: Table basse salon marocain...', 'مثال: طاولة صالون مغربي...')}
                className="w-full text-xs p-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">{tr('Catégorie :', 'الفئة:')}</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as any)}
                className="w-full text-xs p-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.icon} {isAr ? c.labelAr : c.labelFr}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Price & Condition */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">{tr('Prix (en DH) :', 'السعر (بالدرهم):')}</label>
              <input
                type="number"
                min={listingType === 'sale' ? "0.01" : "0"}
                step="0.01"
                disabled={listingType === 'free'}
                value={listingType === 'free' ? 0 : price}
                onChange={(e) => setPrice(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder={listingType === 'free' ? tr('0 DH (Don)', '0 درهم (مجاني)') : 'Ex: 350'}
                className="w-full text-xs p-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono disabled:bg-slate-100"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">{tr("État de l'objet :", 'حالة الغرض:')}</label>
              <select
                value={condition}
                onChange={(e) => setCondition(e.target.value as any)}
                className="w-full text-xs p-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white"
              >
                <option value="new">{tr('Neuf (jamais utilisé)', 'جديد (غير مستعمل)')}</option>
                <option value="like_new">{tr('Comme neuf', 'شبه جديد')}</option>
                <option value="good">{tr('Bon état', 'حالة جيدة')}</option>
                <option value="fair">{tr("État d'usage", 'مستعمل')}</option>
              </select>
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block font-semibold text-slate-700 mb-1">{tr('Description détaillée * :', 'وصف مفصل * :')}</label>
            <textarea
              rows={3}
              required
              maxLength={3000}
              aria-label={tr("Description de l’annonce", "وصف الإعلان")}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={tr(
                "Dimensions, marque, motif de vente, disponibilité pour récupération dans l'immeuble...",
                'الأبعاد، العلامة التجارية، سبب البيع، أوقات التسليم داخل الإقامة...'
              )}
              className="w-full text-xs p-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>

          {/* PHOTO UPLOADER SECTION */}
          <div className="space-y-2 pt-2 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <label className="block font-semibold text-slate-800">
                {tr(`Photos de l'objet (${uploadedPhotos.length}/5) :`, `صور الغرض (${uploadedPhotos.length}/5):`)}
              </label>
              <span className="text-[11px] text-slate-500">
                {tr('La première photo sera utilisée comme photo de couverture.', 'الصورة الأولى ستكون صورة الغلاف.')}
              </span>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                if (e.target.files) handleFilesSelected(e.target.files);
              }}
            />

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all ${
                isDragging
                  ? 'border-teal-500 bg-teal-50/50 scale-[0.99]'
                  : 'border-slate-300 hover:border-teal-500 hover:bg-slate-50/60'
              }`}
            >
              <div className="flex flex-col items-center justify-center gap-1.5">
                <span className="text-3xl">📸</span>
                <p className="text-xs font-bold text-slate-800">
                  {isCompressing
                    ? tr('Optimisation des photos en cours...', 'جاري معالجة الصور...')
                    : tr('Glissez vos photos ici ou cliquez pour parcourir', 'اسحب صورك هنا أو اضغط لاختيارها')}
                </p>
                <p className="text-[11px] text-slate-500">
                  {tr("Formats supportés : JPG, PNG, WEBP · Jusqu'à 5 photos", 'الصيغ المدعومة: JPG, PNG, WEBP · حتى 5 صور')}
                </p>
              </div>
            </div>

            {uploadedPhotos.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 pt-2">
                {uploadedPhotos.map((photoUrl, idx) => (
                  <div
                    key={idx}
                    className="relative group rounded-xl overflow-hidden border border-slate-200 aspect-square bg-slate-100 shadow-xs"
                  >
                    <img src={photoUrl} alt={`Photo ${idx + 1}`} className="w-full h-full object-cover" />

                    {idx === 0 && (
                      <span className="absolute top-1 left-1 bg-teal-600 text-white text-[9px] font-bold px-1.5 py-0.2 rounded shadow">
                        {tr('Principale ★', 'رئيسية ★')}
                      </span>
                    )}

                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-1.5 text-white">
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemovePhoto(idx);
                          }}
                          className="w-5 h-5 rounded-full bg-rose-600 hover:bg-rose-700 flex items-center justify-center text-[10px] font-bold"
                          title={tr('Supprimer la photo', 'حذف الصورة')}
                        >
                          ✕
                        </button>
                      </div>

                      {idx > 0 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSetMainPhoto(idx);
                          }}
                          className="text-[9px] bg-teal-700 hover:bg-teal-800 py-1 px-1.5 rounded font-bold text-center w-full"
                        >
                          {tr('Définir principale', 'تعيين كرئيسية')}
                        </button>
                      )}
                    </div>
                  </div>
                ))}

                {uploadedPhotos.length < 5 && (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-slate-300 hover:border-teal-500 hover:bg-teal-50/30 rounded-xl aspect-square flex flex-col items-center justify-center gap-1 text-slate-500 hover:text-teal-700 transition-all text-xs font-semibold"
                  >
                    <span className="text-xl">+</span>
                    <span className="text-[10px]">{tr('Ajouter photo', 'إضافة صورة')}</span>
                  </button>
                )}
              </div>
            )}

            <div className="pt-1">
              <button
                type="button"
                onClick={() => setShowSamplePicker(!showSamplePicker)}
                className="text-xs text-teal-700 hover:text-teal-900 underline font-medium"
              >
                {showSamplePicker
                  ? tr('Masquer les images modèles prédéfinies', 'إخفاء الصور النموذجية')
                  : tr('Ou choisir une photo modèle prédéfinie...', 'أو اختيار صورة نموذجية جاهزة...')}
              </button>

              {showSamplePicker && (
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mt-2 p-2.5 bg-slate-50 rounded-xl border border-slate-200">
                  {SAMPLE_IMAGES.map((img, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleAddSampleImage(img.url)}
                      className="relative rounded-lg overflow-hidden border border-slate-200 h-14 hover:scale-95 transition-transform group"
                      title={isAr ? img.labelAr : img.labelFr}
                    >
                      <img src={img.url} alt={isAr ? img.labelAr : img.labelFr} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white text-[10px] font-bold">
                        {tr('+ Ajouter', '+ إضافة')}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Seller Contact Info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-100">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                {tr('Numéro de téléphone / WhatsApp :', 'رقم الهاتف / واتساب:')}
              </label>
              <input
                type="text"
                value={sellerPhone}
                onChange={(e) => setSellerPhone(e.target.value)}
                placeholder="0661..."
                className="w-full text-xs p-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">{tr('Coordonnées du lot :', 'بيانات الشقة:')}</label>
              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 text-xs font-mono">
                {currentResidentName} ({currentApartmentNumber})
              </div>
            </div>
          </div>
        </Form>
      </Modal>

      {/* MODAL 2: FULL DETAIL & PHOTO GALLERY LIGHTBOX */}
      {activeDetailItem && (
        <Modal
          isOpen={!!activeDetailItem}
          onClose={() => setActiveDetailItem(null)}
          title={tr(`Détail de l'annonce : ${activeDetailItem.title}`, `تفاصيل الإعلان: ${activeDetailItem.title}`)}
          footer={
            <div className="flex justify-between items-center w-full">
              <div className="text-xs text-slate-500 font-mono">
                {tr('Publié le', 'نُشر في')} {new Date(activeDetailItem.createdAt).toLocaleDateString(isAr ? 'ar-MA' : 'fr-MA')}
              </div>
              <Button variant="secondary" onClick={() => setActiveDetailItem(null)}>
                {tr('Fermer', 'إغلاق')}
              </Button>
            </div>
          }
        >
          <div className="space-y-4 text-xs sm:text-sm">
            <div className="relative h-72 sm:h-96 w-full rounded-2xl overflow-hidden bg-slate-900 flex items-center justify-center shadow-inner">
              <img
                src={modalPhotos[detailPhotoIndex] || modalPhotos[0]}
                alt={activeDetailItem.title}
                className="max-h-full max-w-full object-contain"
              />

              {modalPhotos.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      setDetailPhotoIndex(
                        (prev) => (prev - 1 + modalPhotos.length) % modalPhotos.length
                      )
                    }
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/60 hover:bg-black/90 text-white flex items-center justify-center text-lg font-bold shadow-lg transition-transform hover:scale-105"
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setDetailPhotoIndex((prev) => (prev + 1) % modalPhotos.length)
                    }
                    className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/60 hover:bg-black/90 text-white flex items-center justify-center text-lg font-bold shadow-lg transition-transform hover:scale-105"
                  >
                    ›
                  </button>

                  <div className="absolute bottom-3 right-3 bg-black/70 backdrop-blur-sm text-white px-2.5 py-1 rounded-full text-xs font-mono font-bold">
                    {detailPhotoIndex + 1} / {modalPhotos.length}
                  </div>
                </>
              )}
            </div>

            {modalPhotos.length > 1 && (
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {modalPhotos.map((photo, i) => (
                  <button
                    key={i}
                    onClick={() => setDetailPhotoIndex(i)}
                    className={`relative rounded-xl overflow-hidden h-16 w-16 shrink-0 border-2 transition-all ${
                      i === detailPhotoIndex
                        ? 'border-teal-600 ring-2 ring-teal-300 scale-95'
                        : 'border-transparent opacity-60 hover:opacity-100'
                    }`}
                  >
                    <img src={photo} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t border-slate-100">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-xs uppercase tracking-wider bg-teal-50 text-teal-800 border border-teal-200 px-2.5 py-0.5 rounded-full">
                  {CATEGORIES.find((c) => c.id === activeDetailItem.category)?.icon}{' '}
                  {isAr
                    ? CATEGORIES.find((c) => c.id === activeDetailItem.category)?.labelAr
                    : CATEGORIES.find((c) => c.id === activeDetailItem.category)?.labelFr}
                </span>

                {activeDetailItem.condition && (
                  <span className="text-slate-600 bg-slate-100 text-xs px-2.5 py-0.5 rounded-full font-medium">
                    {tr('État :', 'الحالة:')}{' '}
                    {activeDetailItem.condition === 'new'
                      ? tr('Neuf', 'جديد')
                      : activeDetailItem.condition === 'like_new'
                      ? tr('Comme neuf', 'شبه جديد')
                      : activeDetailItem.condition === 'good'
                      ? tr('Bon état', 'حالة جيدة')
                      : tr("État d'usage", 'مستعمل')}
                  </span>
                )}
              </div>

              <div className="text-xl font-bold font-mono text-teal-900">
                {activeDetailItem.type === 'free'
                  ? tr('0 DH (Don Gratuit)', '0 درهم (تبرع مجاني)')
                  : currencyFormatter.format(activeDetailItem.price)}
              </div>
            </div>

            <div className="space-y-1 bg-slate-50 p-4 rounded-xl border border-slate-200">
              <h4 className="font-bold text-slate-900 text-sm">{tr('Description :', 'الوصف:')}</h4>
              <p className="text-xs text-slate-700 whitespace-pre-line leading-relaxed">
                {activeDetailItem.description}
              </p>
            </div>

            <div className="p-4 rounded-xl border border-teal-200 bg-teal-50/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-0.5">
                <div className="text-xs text-slate-500 font-semibold uppercase">
                  {tr('Voisin Vendeur / Donateur', 'الجار البائع / المتبرع')}
                </div>
                <div className="font-bold text-slate-900 text-sm">{activeDetailItem.residentName}</div>
                <div className="text-xs text-teal-800 font-mono font-semibold">
                  {tr('Appartement :', 'الشقة:')} {activeDetailItem.apartmentNumber}
                </div>
              </div>

              {activeDetailItem.status !== 'sold' && (
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => {
                      const target = activeDetailItem;
                      setActiveDetailItem(null);
                      handleOpenChatForItem(target);
                    }}
                    className="flex items-center gap-1.5 py-2 px-4 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-bold text-xs transition-colors shadow-xs"
                  >
                    <span>💬</span>
                    <span>{tr('Discuter sur la plateforme', 'المحادثة عبر المنصة')}</span>
                    {(messageCountByItemId[activeDetailItem.id] || 0) > 0 && (
                      <span className="bg-amber-400 text-slate-950 font-mono text-[10px] font-extrabold px-1.5 py-0.5 rounded-full">
                        {messageCountByItemId[activeDetailItem.id]}
                      </span>
                    )}
                  </button>
                  <a
                    href={`https://wa.me/${(activeDetailItem.whatsapp || activeDetailItem.phone || '').replace(/\s+/g, '').replace('+', '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition-colors shadow-xs"
                  >
                    <WhatsAppIcon />
                    <span>WhatsApp</span>
                  </a>
                  <a
                    href={`tel:${(activeDetailItem.phone || '').replace(/\s+/g, '')}`}
                    className="flex items-center gap-1.5 py-2 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition-colors shadow-xs"
                  >
                    <PhoneIcon />
                    <span>{tr('Appeler', 'اتصال')}</span>
                  </a>
                </div>
              )}
            </div>

            {activeDetailItem.residentId === currentResidentId && (
              <div className="p-3 bg-slate-100 rounded-xl flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-700">{tr('Gestion de votre annonce :', 'إدارة إعلانك:')}</span>
                <div className="flex items-center gap-2">
                  {activeDetailItem.status !== 'sold' ? (
                    <button
                      onClick={() =>
                        statusMutation.mutate({ id: activeDetailItem.id, status: 'sold' })
                      }
                      className="px-2.5 py-1 bg-rose-600 text-white rounded font-bold hover:bg-rose-700"
                    >
                      {tr('Marquer comme Vendu', 'تحديد كمباع')}
                    </button>
                  ) : (
                    <button
                      onClick={() =>
                        statusMutation.mutate({ id: activeDetailItem.id, status: 'available' })
                      }
                      className="px-2.5 py-1 bg-teal-600 text-white rounded font-bold hover:bg-teal-700"
                    >
                      {tr('Remettre en vente', 'إعادة العرض للبيع')}
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (confirm(tr('Supprimer définitivement cette annonce ?', 'هل تريد حذف هذا الإعلان نهائياً؟'))) {
                        deleteMutation.mutate(activeDetailItem.id);
                      }
                    }}
                    className="px-2.5 py-1 text-rose-600 hover:bg-rose-50 border border-rose-300 rounded font-bold"
                  >
                    {tr('Supprimer', 'حذف')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* MODAL 3: IN-PLATFORM ITEM CHAT MODAL */}
      {activeChatListing && (
        <Modal
          isOpen={!!activeChatListing}
          onClose={() => setActiveChatListing(null)}
          title={tr('💬 Messagerie Interne · Le Souk des Résidents', '💬 المراسلة الداخلية · سوق الجيران')}
          footer={
            <div className="flex justify-between items-center w-full">
              <span className="text-[11px] text-slate-500">
                🔒 {tr(`Échange sécurisé entre résidents de ${building.name}`, `تواصل آمن بين سكان ${building.name}`)}
              </span>
              <Button variant="secondary" onClick={() => setActiveChatListing(null)}>
                {tr('Fermer', 'إغلاق')}
              </Button>
            </div>
          }
        >
          <div className="space-y-3 text-xs">
            <div className="p-3 rounded-xl bg-teal-50/80 border border-teal-200 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <img
                  src={
                    (activeChatListing.images && activeChatListing.images[0]) ||
                    activeChatListing.imageUrl ||
                    SAMPLE_IMAGES[0].url
                  }
                  alt={activeChatListing.title}
                  className="w-14 h-14 rounded-lg object-cover border border-teal-300 shrink-0"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-teal-700 text-white">
                      {activeChatListing.type === 'free'
                        ? tr('Don', 'تبرع')
                        : activeChatListing.type === 'service'
                        ? tr('Service', 'خدمة')
                        : tr('À vendre', 'للبيع')}
                    </span>
                    <span className="font-mono font-bold text-teal-900 text-xs">
                      {activeChatListing.type === 'free'
                        ? '0 DH'
                        : currencyFormatter.format(activeChatListing.price)}
                    </span>
                  </div>
                  <h4 className="font-bold text-slate-900 text-xs sm:text-sm truncate mt-0.5">
                    {activeChatListing.title}
                  </h4>
                  <p className="text-[11px] text-slate-600">
                    {tr('Vendeur :', 'البائع:')} <strong>{activeChatListing.residentName}</strong> ({activeChatListing.apartmentNumber})
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  const target = activeChatListing;
                  setActiveChatListing(null);
                  handleOpenDetails(target, 0);
                }}
                className="px-2.5 py-1.5 rounded-lg bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 font-semibold text-[11px] shrink-0"
              >
                {tr('Voir annonce', 'عرض الإعلان')}
              </button>
            </div>

            {activeChatListing.residentId === currentResidentId && <label className="block mb-3 text-sm font-bold">{tr('Conversation avec','المحادثة مع')}<select className="border rounded p-2 ms-2" value={activeBuyer} onChange={e=>setActiveBuyer(e.target.value)}><option value="">{tr('Choisir un acheteur','اختر مشترياً')}</option>{[...new Set(allMarketplaceMessages.filter(m=>m.marketplaceItemId===activeChatListing.id).map(m=>m.senderId===currentResidentId?m.recipientId:m.senderId))].filter(Boolean).map(id=><option key={id} value={id}>{allMarketplaceMessages.find(m=>m.senderId===id)?.senderName || tr('Acheteur','المشتري')}</option>)}</select></label>}
            <div className="h-72 overflow-y-auto p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
              {activeItemMessages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 p-4 space-y-1.5">
                  <span className="text-3xl">👋</span>
                  <p className="font-bold text-slate-700 text-xs">
                    {tr(
                      `Démarrez la discussion avec ${activeChatListing.residentName} (${activeChatListing.apartmentNumber})`,
                      `ابدأ المحادثة مع ${activeChatListing.residentName} (${activeChatListing.apartmentNumber})`
                    )}
                  </p>
                  <p className="text-[11px] text-slate-500 max-w-xs">
                    {tr(
                      "Posez vos questions sur l'état de l'article, proposez un créneau pour passer le voir ou convenez d'un prix directement sur la plateforme.",
                      'اطرح أسئلتك حول حالة الغرض، اقترح موعداً لمعاينته أو اتفق على السعر مباشرة عبر المنصة.'
                    )}
                  </p>
                </div>
              ) : (
                activeItemMessages.map((msg) => {
                  const isMe = msg.senderId === currentResidentId;
                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                    >
                      <div className="flex items-center gap-1.5 text-[10px] text-slate-500 mb-1">
                        <span className="font-bold text-slate-800">{msg.senderName}</span>
                        {msg.senderApartment && (
                          <span className="font-mono bg-slate-200/80 text-slate-700 px-1.5 py-0.2 rounded">
                            {msg.senderApartment}
                          </span>
                        )}
                        <span className="font-mono text-slate-400">
                          {new Date(msg.createdAt).toLocaleTimeString(isAr ? 'ar-MA' : 'fr-MA', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <div
                        className={`max-w-[85%] p-3 rounded-2xl text-xs leading-relaxed shadow-xs ${
                          isMe
                            ? 'bg-teal-700 text-white rounded-tr-xs'
                            : 'bg-white text-slate-800 border border-slate-200 rounded-tl-xs'
                        }`}
                      >
                        {msg.content}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={chatBottomRef} />
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              {[
                tr('Salam, cet article est-il toujours disponible ?', 'السلام عليكم، هل هذا الغرض لا يزال متوفراً؟'),
                tr("Puis-je passer le voir aujourd'hui ?", 'هل يمكنني المرور لمعاينته اليوم؟'),
                tr('Le prix est-il légèrement négociable ?', 'هل السعر قابل للتفاوض قليلاً؟'),
                tr('Je suis intéressé(e), je le prends !', 'أنا مهتم، سأشتريه!'),
              ].map((quickText, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setChatInputText(quickText)}
                  className="px-2.5 py-1 rounded-full bg-slate-100 hover:bg-teal-50 hover:text-teal-800 hover:border-teal-300 text-slate-700 border border-slate-200 text-[11px] font-medium whitespace-nowrap transition-colors"
                >
                  {quickText}
                </button>
              ))}
            </div>

            <Form onSubmit={handleSendMarketplaceChat} className="flex items-center gap-2 pt-1">
              <input
                type="text"
                value={chatInputText}
                onChange={(e) => setChatInputText(e.target.value)}
                placeholder={tr(
                  `Écrire à ${activeChatListing.residentName} (${activeChatListing.apartmentNumber})...`,
                  `اكتب رسالة إلى ${activeChatListing.residentName} (${activeChatListing.apartmentNumber})...`
                )}
                className="flex-1 text-xs p-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white"
              />
              <Button
                type="submit"
                disabled={!chatInputText.trim() || sendChatMutation.isPending}
                className="bg-teal-700 hover:bg-teal-800 text-white font-bold text-xs px-4 py-2.5 rounded-xl shrink-0"
              >
                {sendChatMutation.isPending ? tr('Envoi...', 'جاري الإرسال...') : tr('Envoyer ✈️', 'إرسال ✈️')}
              </Button>
            </Form>
          </div>
        </Modal>
      )}

      {/* MODAL 4: MARKETPLACE DISCUSSIONS INBOX */}
      {isInboxOpen && (
        <Modal
          isOpen={isInboxOpen}
          onClose={() => setIsInboxOpen(false)}
          title={tr('💬 Toutes les Discussions du Souk (Messagerie Interne)', '💬 جميع محادثات السوق (المراسلة الداخلية)')}
          footer={
            <div className="flex justify-end">
              <Button variant="secondary" onClick={() => setIsInboxOpen(false)}>
                {tr('Fermer', 'إغلاق')}
              </Button>
            </div>
          }
        >
          <div className="space-y-3 text-xs max-h-96 overflow-y-auto pe-1">
            {items.filter((it) => (messageCountByItemId[it.id] || 0) > 0).length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                {tr(
                  "Aucune discussion active sur les annonces pour le moment. Cliquez sur « Discuter sur la plateforme » sur n'importe quelle annonce pour contacter un voisin !",
                  'لا توجد محادثات نشطة حول الإعلانات حالياً. اضغط على "المحادثة عبر المنصة" في أي إعلان للتواصل مع جارك!'
                )}
              </div>
            ) : (
              items
                .filter((it) => (messageCountByItemId[it.id] || 0) > 0)
                .map((it) => {
                  const itemMsgs = allMarketplaceMessages.filter(
                    (m) => m.channelId === `market-${it.id}` || m.marketplaceItemId === it.id
                  );
                  const lastMsg = itemMsgs[itemMsgs.length - 1];
                  return (
                    <div
                      key={it.id}
                      onClick={() => {
                        setIsInboxOpen(false);
                        handleOpenChatForItem(it);
                      }}
                      className="p-3.5 rounded-xl border border-slate-200 hover:border-teal-400 hover:bg-teal-50/40 cursor-pointer transition-all flex items-center justify-between gap-3 bg-white"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <img
                          src={(it.images && it.images[0]) || it.imageUrl || SAMPLE_IMAGES[0].url}
                          alt={it.title}
                          className="w-12 h-12 rounded-lg object-cover border border-slate-200 shrink-0"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900 text-xs truncate">
                              {it.title}
                            </span>
                            <span className="font-mono text-[11px] font-bold text-teal-800">
                              {it.type === 'free' ? '0 DH' : currencyFormatter.format(it.price)}
                            </span>
                          </div>
                          {lastMsg && (
                            <p className="text-[11px] text-slate-600 truncate mt-0.5">
                              <strong>{lastMsg.senderName} :</strong> {lastMsg.content}
                            </p>
                          )}
                          <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                            {tr('Annonce de', 'إعلان من طرف')} {it.residentName} ({it.apartmentNumber})
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className="bg-teal-700 text-white font-mono text-[10px] font-bold px-2 py-0.5 rounded-full">
                          {itemMsgs.length} msg
                        </span>
                        <span className="text-[11px] text-teal-700 font-semibold">{tr('Ouvrir →', 'فتح ←')}</span>
                      </div>
                    </div>
                  );
                })
            )}
          </div>
        </Modal>
      )}
    </div>
  );
};

export default MarketplaceView;

