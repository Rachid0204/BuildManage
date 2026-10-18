import React, { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Building, ChatMessage, ChatChannelType } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import Card from '../common/Card';
import Button from '../common/Button';
import { ChatIcon } from '../icons/IconComponents';
import { getChatMessages, sendChatMessage, toggleChatMessageLike } from '../../firebase/services';
import Loading from '../common/Loading';
import { useI18n } from '../../hooks/useI18n';

interface CommunityChatProps {
  building: Building;
  isResidentPortal?: boolean;
  currentResidentId?: string;
  currentResidentName?: string;
  currentApartmentNumber?: string;
}

interface ChannelDef {
  id: string;
  name: string;
  type: ChatChannelType;
  description: string;
  icon: string;
  badge?: string;
}

export const CommunityChat: React.FC<CommunityChatProps> = ({
  building,
  isResidentPortal = false,
  currentResidentId,
  currentResidentName,
  currentApartmentNumber,
}) => {
  const { tr } = useI18n();
  const { userProfile } = useAuth();
  const queryClient = useQueryClient();
  const [activeChannelId, setActiveChannelId] = useState<string>('general');
  const [inputText, setInputText] = useState('');
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const CHANNELS: ChannelDef[] = [
    {
      id: 'general',
      name: tr('Canal Général de la Résidence', 'القناة العامة للإقامة'),
      type: 'general',
      description: tr(
        "Espace d'échanges collectifs, nouvelles de l'immeuble et vie de quartier.",
        'فضاء للتبادل الجماعي وأخبار العمارة والحياة المشتركة.'
      ),
      icon: '📢',
    },
    {
      id: 'syndic',
      name: tr('Bureau du Syndic (Officiel)', 'مكتب السنديك (رسمي)'),
      type: 'syndic',
      description: tr(
        "Dialogue officiel avec l'équipe du Syndic, réclamations et suivi administratif.",
        'تواصل رسمي مع فريق السنديك، الشكايات والتتبع الإداري.'
      ),
      icon: '🏢',
      badge: tr('Officiel', 'رسمي'),
    },
    {
      id: 'help',
      name: tr('Entraide & Bon Voisinage', 'التعاون وحسن الجوار'),
      type: 'help',
      description: tr(
        "Prêt d'outils, dépannage, covoiturage, garde de plantes, colis.",
        'إعارة الأدوات، المساعدة بين الجيران، النقل المشترك واستلام الطرود.'
      ),
      icon: '🤝',
    },
    {
      id: 'marketplace',
      name: tr('Le Souk des Résidents (Discussions)', 'سوق الإقامة (مناقشات)'),
      type: 'marketplace',
      description: tr(
        'Échanges, offres et négociations entre voisins sur les annonces du Souk.',
        'تبادلات، عروض ومفاوضات بين الجيران حول إعلانات سوق الإقامة.'
      ),
      icon: '🛍️',
      badge: tr('Souk', 'السوق'),
    },
  ];

  const PRESET_TOPIC_PILLS = [
    { label: tr('#Question', '#سؤال'), tag: tr('Question', 'سؤال') },
    { label: tr('#Urgent', '#مستعجل'), tag: tr('Urgent', 'مستعجل') },
    { label: tr('#Travaux', '#أشغال'), tag: tr('Information Travaux', 'معلومات أشغال') },
    { label: tr('#Voisinage', '#جوار'), tag: tr('Entraide', 'تعاون') },
    { label: tr('#Parking', '#مرآب'), tag: tr('Parking', 'المرآب') },
  ];

  const isSyndicUser = !isResidentPortal && userProfile?.role !== 'resident';
  const effectiveSenderId = isSyndicUser
    ? userProfile?.uid || 'syndic-user'
    : currentResidentId || userProfile?.uid || 'res-2';

  const effectiveSenderName = isSyndicUser
    ? tr('Syndic Gestionnaire', 'وكيل الاتحاد (السنديك)')
    : currentResidentName || userProfile?.displayName || tr('Copropriétaire', 'مالك مشترك');

  const effectiveApartment = isSyndicUser
    ? tr('Bureau Syndic', 'مكتب السنديك')
    : currentApartmentNumber || `${tr('Lot', 'شقة')} A-102`;

  const effectiveRole: 'syndic' | 'resident' = isSyndicUser ? 'syndic' : 'resident';

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ['chatMessages', building.id, activeChannelId],
    queryFn: () => getChatMessages(building.id, activeChannelId),
    refetchInterval: 5000,
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, activeChannelId]);

  const sendMutation = useMutation({
    mutationFn: (content: string) => {
      const payload: Omit<ChatMessage, 'id' | 'createdAt'> = {
        buildingId: building.id,
        channelId: activeChannelId,
        senderId: effectiveSenderId,
        senderName: effectiveSenderName,
        senderRole: effectiveRole,
        senderApartment: effectiveApartment,
        content,
        badge: selectedTopic || (effectiveRole === 'syndic' ? tr('Annonce Syndic', 'إعلان السنديك') : undefined),
      };
      return sendChatMessage(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chatMessages', building.id, activeChannelId] });
      setInputText('');
      setSelectedTopic(null);
    },
  });

  const likeMutation = useMutation({
    mutationFn: (messageId: string) => toggleChatMessageLike(messageId, effectiveSenderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chatMessages', building.id, activeChannelId] });
    },
  });

  const handleSend = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = inputText.trim();
    if (!trimmed) return;
    sendMutation.mutate(trimmed);
  };

  const currentChannel = CHANNELS.find((c) => c.id === activeChannelId) || CHANNELS[0];

  const filteredMessages = messages.filter((m) => {
    if (!searchFilter.trim()) return true;
    const q = searchFilter.toLowerCase();
    return (
      m.content.toLowerCase().includes(q) ||
      m.senderName.toLowerCase().includes(q) ||
      (m.senderApartment && m.senderApartment.toLowerCase().includes(q))
    );
  });

  return (
    <div className="space-y-4">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <span className="p-1.5 bg-teal-100 text-teal-800 rounded-lg">
                <ChatIcon />
              </span>
              <span>{tr('Messagerie & Espace Communautaire', 'المحادثات والفضاء التشاركي للجيران')}</span>
            </h1>
            <span className="text-xs bg-emerald-100 text-emerald-800 font-semibold px-2.5 py-0.5 rounded-full flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              {tr('En direct', 'مباشر')}
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            {tr(
              `Connectez en toute transparence les copropriétaires, locataires et le Syndic de ${building.name}.`,
              `تواصل شفاف ومباشر بين الملاك المشتركين، المكترين ومكتب السنديك لإقامة ${building.name}.`
            )}
          </p>
        </div>

        {/* User Presence Badge */}
        <div className="flex items-center gap-2 text-xs bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm self-start sm:self-auto">
          <div className={`w-2.5 h-2.5 rounded-full ${isSyndicUser ? 'bg-indigo-600' : 'bg-teal-600'}`}></div>
          <span className="text-slate-500">{tr('Connecté en tant que :', 'متصل بصفة :')}</span>
          <span className="font-semibold text-slate-900">
            {effectiveSenderName} ({effectiveApartment})
          </span>
        </div>
      </div>

      {/* Mobile Horizontal Channel Switcher (< lg) */}
      <div className="lg:hidden flex items-center gap-2 overflow-x-auto no-scrollbar pb-1 -mx-1 px-1">
        {CHANNELS.map((ch) => {
          const isActive = ch.id === activeChannelId;
          return (
            <button
              key={ch.id}
              type="button"
              onClick={() => setActiveChannelId(ch.id)}
              className={`flex items-center gap-2 px-3.5 py-2.5 min-h-[44px] rounded-xl text-xs font-bold whitespace-nowrap transition-all border shrink-0 ${
                isActive
                  ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <span>{ch.icon}</span>
              <span>{ch.name}</span>
              {ch.badge && (
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                    isActive ? 'bg-teal-600 text-white' : 'bg-teal-100 text-teal-800'
                  }`}
                >
                  {ch.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Main Chat Layout Container */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:h-[680px]">
        {/* Left Column: Channels & Topic Switcher (Desktop Only) */}
        <div className="hidden lg:flex lg:col-span-4 flex-col gap-3 h-full">
          <Card className="p-4 flex-1 flex flex-col bg-white border border-slate-200">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
              {tr('Canaux de Discussion', 'قنوات النقاش')}
            </h3>

            <div className="space-y-2 flex-1">
              {CHANNELS.map((ch) => {
                const isActive = ch.id === activeChannelId;
                return (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => setActiveChannelId(ch.id)}
                    className={`w-full text-start p-3 rounded-xl transition-all border ${
                      isActive
                        ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                        : 'bg-slate-50 hover:bg-slate-100 text-slate-800 border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span className="text-lg">{ch.icon}</span>
                        <span className="text-xs font-bold truncate">{ch.name}</span>
                      </div>
                      {ch.badge && (
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            isActive
                              ? 'bg-teal-600 text-white'
                              : 'bg-teal-100 text-teal-800'
                          }`}
                        >
                          {ch.badge}
                        </span>
                      )}
                    </div>
                    <p
                      className={`text-[11px] mt-1 line-clamp-2 ${
                        isActive ? 'text-slate-300' : 'text-slate-500'
                      }`}
                    >
                      {ch.description}
                    </p>
                  </button>
                );
              })}
            </div>

            {/* Co-ownership Guidelines Info Box */}
            <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-[11px] text-amber-900 space-y-1">
              <div className="font-semibold flex items-center gap-1 text-amber-950">
                <span>⚖️ {tr('Charte de Bon Voisinage', 'ميثاق حسن الجوار')}</span>
              </div>
              <p className="text-amber-800 leading-relaxed">
                {tr(
                  'Cet espace est régi par la courtoisie et le respect du Règlement de Copropriété (Loi 18-00). Restons bienveillants et constructifs !',
                  'يخضع هذا الفضاء لقواعد الاحترام المتبادل ونظام الملكية المشتركة (قانون 18-00). لنحافظ على روح التعاون وحسن الجوار!'
                )}
              </p>
            </div>
          </Card>
        </div>

        {/* Right Column: Chat Stream & Message Input (8 cols) */}
        <div className="lg:col-span-8 flex flex-col h-[520px] sm:h-[600px] lg:h-full bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          {/* Active Channel Header */}
          <div className="px-4 sm:px-5 py-3 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex items-center gap-2.5">
              <span className="text-xl">{currentChannel.icon}</span>
              <div>
                <h2 className="font-bold text-slate-900 text-sm">{currentChannel.name}</h2>
                <p className="text-[11px] text-slate-500">{currentChannel.description}</p>
              </div>
            </div>

            {/* Quick in-chat search */}
            <div className="relative w-full sm:w-48">
              <input
                type="text"
                placeholder={tr('Filtrer messages...', 'بحث في الرسائل...')}
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                className="w-full text-xs ps-7 pe-3 py-1.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-teal-500"
              />
              <span className="absolute start-2.5 top-2 text-slate-400 text-xs">🔍</span>
              {searchFilter && (
                <button
                  onClick={() => setSearchFilter('')}
                  className="absolute end-2 top-1.5 text-xs text-slate-400 hover:text-slate-600"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Messages Scroll Area */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 bg-slate-50/50">
            {isLoading ? (
              <Loading message={tr('Chargement des messages...', 'جاري تحميل الرسائل...')} />
            ) : filteredMessages.length === 0 ? (
              <div className="text-center py-12 text-slate-400 space-y-2">
                <span className="text-3xl block">💬</span>
                <p className="text-sm font-medium">
                  {tr(
                    'Aucun message pour le moment dans ce canal.',
                    'لا توجد أي رسالة حالياً في هذه القناة.'
                  )}
                </p>
                <p className="text-xs">
                  {tr(
                    'Soyez le premier à engager la conversation !',
                    'كن أول من يبدأ المحادثة!'
                  )}
                </p>
              </div>
            ) : (
              filteredMessages.map((msg) => {
                const isMe = msg.senderId === effectiveSenderId;
                const isSyndicSender = msg.senderRole === 'syndic';
                const hasLiked = msg.likes?.includes(effectiveSenderId);

                return (
                  <div
                    key={msg.id}
                    className={`flex gap-3 text-xs ${
                      isMe ? 'flex-row-reverse' : 'flex-row'
                    }`}
                  >
                    {/* Avatar */}
                    <div
                      className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs shrink-0 shadow-sm ${
                        isSyndicSender
                          ? 'bg-blue-900 text-amber-300 ring-2 ring-amber-400'
                          : isMe
                          ? 'bg-teal-700 text-white'
                          : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {isSyndicSender ? '🏢' : msg.senderName.charAt(0).toUpperCase()}
                    </div>

                    {/* Message Bubble Container */}
                    <div
                      className={`max-w-[80%] sm:max-w-[70%] space-y-1 ${
                        isMe ? 'items-end' : 'items-start'
                      }`}
                    >
                      <div
                        className={`flex items-center gap-1.5 text-[11px] ${
                          isMe ? 'justify-end' : 'justify-start'
                        }`}
                      >
                        <span className="font-bold text-slate-900">
                          {msg.senderName}
                        </span>

                        {msg.senderApartment && (
                          <span
                            className={`px-1.5 py-0.2 rounded text-[10px] font-mono ${
                              isSyndicSender
                                ? 'bg-amber-100 text-amber-900 font-bold'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {msg.senderApartment}
                          </span>
                        )}

                        {isSyndicSender && (
                          <span className="text-[10px] bg-blue-100 text-blue-900 font-semibold px-1 rounded">
                            {tr('Syndic', 'السنديك')}
                          </span>
                        )}

                        <span className="text-slate-400 text-[10px] font-mono">
                          {new Date(msg.createdAt).toLocaleTimeString('fr-MA', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>

                      {/* Content Bubble */}
                      <div
                        className={`p-3.5 rounded-2xl shadow-sm text-xs leading-relaxed whitespace-pre-wrap break-words ${
                          isSyndicSender
                            ? 'bg-blue-950 text-white rounded-tl-sm border border-blue-800'
                            : isMe
                            ? 'bg-teal-600 text-white rounded-tr-sm'
                            : 'bg-white text-slate-800 rounded-tl-sm border border-slate-200'
                        }`}
                      >
                        {msg.marketplaceItemTitle && (
                          <div
                            className={`mb-2 p-2 rounded-lg text-[11px] flex items-center justify-between gap-2 ${
                              isMe
                                ? 'bg-teal-800/80 text-teal-50 border border-teal-500/40'
                                : 'bg-slate-50 text-slate-700 border border-slate-200'
                            }`}
                          >
                            <span className="font-bold truncate">
                              🛍️ {msg.marketplaceItemTitle}
                            </span>
                            {msg.marketplaceItemPrice !== undefined && (
                              <span className="font-mono font-bold shrink-0">
                                {msg.marketplaceItemPrice === 0
                                  ? tr('Don', 'تبرع مجاني')
                                  : `${msg.marketplaceItemPrice} DH`}
                              </span>
                            )}
                          </div>
                        )}
                        {msg.badge && (
                          <div className="mb-1.5">
                            <span
                              className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full ${
                                isSyndicSender
                                  ? 'bg-amber-400 text-slate-950'
                                  : isMe
                                  ? 'bg-teal-700 text-teal-100'
                                  : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              🏷️ {msg.badge}
                            </span>
                          </div>
                        )}
                        <p>{msg.content}</p>
                      </div>

                      {/* Like Action */}
                      <div
                        className={`flex items-center gap-2 pt-0.5 text-[11px] text-slate-400 ${
                          isMe ? 'justify-end' : 'justify-start'
                        }`}
                      >
                        <button
                          onClick={() => likeMutation.mutate(msg.id)}
                          className={`flex items-center gap-1 px-2 py-0.5 rounded-full transition-colors ${
                            hasLiked
                              ? 'bg-rose-50 text-rose-600 font-bold'
                              : 'hover:bg-slate-200 text-slate-500'
                          }`}
                          title={tr('Aimer ce message', 'إعجاب بهذه الرسالة')}
                        >
                          <span>{hasLiked ? '❤️' : '🤍'}</span>
                          <span>{msg.likes?.length || 0}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Preset Topic Tags Bar */}
          <div className="px-4 py-2 bg-slate-100 border-t border-slate-200 flex items-center gap-2 overflow-x-auto text-xs">
            <span className="text-[11px] font-semibold text-slate-500 whitespace-nowrap">
              {tr('Ajouter un tag :', 'إضافة وسم :')}
            </span>
            {PRESET_TOPIC_PILLS.map((p) => {
              const isSelected = selectedTopic === p.tag;
              return (
                <button
                  key={p.tag}
                  type="button"
                  onClick={() => setSelectedTopic(isSelected ? null : p.tag)}
                  className={`px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
                    isSelected
                      ? 'bg-teal-700 text-white font-bold shadow-sm'
                      : 'bg-white text-slate-600 hover:bg-slate-200 border border-slate-200'
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
            {selectedTopic && (
              <button
                type="button"
                onClick={() => setSelectedTopic(null)}
                className="text-[10px] text-rose-600 hover:underline font-semibold"
              >
                {tr('Retirer tag', 'إزالة الوسم')}
              </button>
            )}
          </div>

          {/* Message Input Box Form */}
          <form
            onSubmit={handleSend}
            className="p-3 bg-white border-t border-slate-200 flex items-center gap-2"
          >
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={tr(
                `Écrire un message dans #${currentChannel.name}...`,
                `اكتب رسالة في #${currentChannel.name}...`
              )}
              className="flex-1 text-xs sm:text-sm px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500 bg-slate-50"
              disabled={sendMutation.isPending}
            />

            <Button
              type="submit"
              disabled={!inputText.trim() || sendMutation.isPending}
              className="text-xs sm:text-sm px-4 py-2.5 font-bold shadow-sm shrink-0 flex items-center gap-1.5"
            >
              <span>{tr('Envoyer', 'إرسال')}</span>
              <span>✈️</span>
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default CommunityChat;
