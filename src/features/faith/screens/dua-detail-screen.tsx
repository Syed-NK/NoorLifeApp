import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { PressableScale } from '@ds/components';
import { modulePalettes } from '@ds/tokens';
import { ModuleText } from '@features/modules/components';
import { ModuleCard } from '@features/modules/components/module-card';
import {
  moduleLayout,
  moduleNeutrals,
  readerPageBackground,
} from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';

import { DuaDetailView } from '../components/dua-detail-view';
import { FaithScreen } from '../components/faith-screen';
import {
  duaDetailPresentation,
  duaResolutionRef,
  resolveDuaDetail,
  type DuaDetailTarget,
} from '../data/duas/dua-detail';
import { reviewedDuas } from '../data/duas/reviewed-dua';
import { faithNavKeys, faithRoutes, readerHref } from '../faith-routes';
import { useQuranSelections } from '../hooks/use-quran-selections';
import { useTasbih } from '../hooks/use-tasbih';

/**
 * **Faith → Duas → one Dua.**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What this screen does, and the short list of what it decides ───────────
 * It resolves a route parameter to a target, resolves that target's scripture against the retained
 * generation, hands both to `duaDetailPresentation`, and renders the result. It decides which store the
 * id belongs to (by prefix, not by trying both) and it sequences the two handoffs. Everything else —
 * which sections exist, what may be claimed, what is omitted — is decided in the domain layer, where it
 * can be asserted without a render.
 *
 * ── Nothing here can reach the network ─────────────────────────────────────
 * `useQuranSelections` reads one storage key and the published generation, and `resolve` is a pure
 * function over an index already in memory — see that hook's note. So a Dua opens cold, in an
 * aeroplane, on the first frame, and a device with no generation says so honestly rather than spinning
 * against a connection somebody may not have.
 *
 * ── Both handoffs are awaited before anything navigates ────────────────────
 * The Tasbih sequence is the one that has already been wrong on a device: fired and forgotten, the push
 * wins the race, the counter screen mounts, and `useTasbih` reads the store *before* `chooseCounter`'s
 * write lands — so the counter opens captioned with whichever selection was active before. Nothing was
 * lost from storage either time; what was wrong was what the user saw, on the one screen whose entire
 * job is to show what they are counting. See the same note on `dua-category-screen.tsx`.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const EMERALD_DEEP = modulePalettes.faith.dark;

export function DuaDetailScreen({ duaId }: { readonly duaId: string }) {
  const selections = useQuranSelections();
  const reviewed = useMemo(() => reviewedDuas(), []);

  const target = useMemo(
    () => resolveDuaDetail({ duaId, selections: selections.selections, reviewed }),
    [duaId, selections.selections, reviewed],
  );

  return (
    <FaithScreen
      title="Dua"
      activeKey={faithNavKeys.more}
      background={readerPageBackground}
      testID="faith-dua-detail-screen"
    >
      {target === null ? (
        /*
          ── Loading and missing are not the same answer ─────────────────────
          While the first read is in flight a personal id genuinely is not found yet, and saying "this
          does not exist" then would be a wrong statement that resolves itself a frame later — the same
          conflation of "not yet decided" with "no" that `FaithRouteGuard` refuses to make about
          authentication.
        */
        selections.loading ? null : (
          <UnknownDua duaId={duaId} />
        )
      ) : (
        <FoundDua target={target} selections={selections} />
      )}
    </FaithScreen>
  );
}

function FoundDua({
  target,
  selections,
}: {
  readonly target: DuaDetailTarget;
  readonly selections: ReturnType<typeof useQuranSelections>;
}) {
  const router = useRouter();
  const tasbih = useTasbih();

  const ref = duaResolutionRef(target);
  const presentation = duaDetailPresentation(
    target,
    /* `null` for a source this device cannot resolve — today only Hadith, which cannot be approved. */
    ref === null ? null : selections.resolve(ref),
  );

  return (
    <DuaDetailView
      presentation={presentation}
      onOpenInReader={() => {
        const reader = presentation.readerTarget;
        if (reader !== null) {
          router.push(readerHref(reader.surah, reader.ayah));
        }
      }}
      onUseInTasbih={() => {
        void (async () => {
          /*
            Stamped as used only for a selection the user owns. A reviewed entry has no `lastUsedAt` —
            that is the user's own record about their own reference, and writing one for a catalogue
            entry would put it in the Continue card as though they had chosen it.
          */
          if (target.kind === 'personal') {
            await selections.markUsed(presentation.counterId);
          }
          await tasbih.chooseCounter(presentation.counterId, presentation.repetition ?? undefined);
          router.push(faithRoutes.tasbih);
        })();
      }}
      onToggleFavourite={() => {
        /* Offered only when `favourite` is not `null`, which is only ever a personal selection. */
        if (presentation.favourite !== null) {
          void selections.toggleFavourite(presentation.counterId);
        }
      }}
      onOpenSourceInfo={() => router.push(faithRoutes.contentInfo)}
    />
  );
}

/**
 * A detail id that names nothing.
 *
 * Reachable by a hand-typed link, and by opening a selection that has since been removed on another
 * device. Answered plainly rather than by redirecting to the library — a screen that quietly shows
 * something else makes a broken link look like a working one, which is the decision `UnknownCategory`
 * already records for the category route.
 */
function UnknownDua({ duaId }: { readonly duaId: string }) {
  const { dp } = useModuleMetrics();
  const router = useRouter();

  return (
    <View style={{ rowGap: dp(moduleLayout.cardGap) }}>
      <ModuleCard testID="faith-dua-detail-unknown">
        <View style={{ rowGap: dp(4) }}>
          <ModuleText token="cardTitle" numberOfLines={2} accessibilityRole="header">
            That dua is not here
          </ModuleText>
          <ModuleText token="caption" numberOfLines={4}>
            {/*
              The id is deliberately not echoed. It is either one of the user's own selection addresses
              or a manifest id, and neither belongs in a message somebody may screenshot.
            */}
            The link you followed does not name a dua on this device. If it was one of your
            selections, it may have been removed.
          </ModuleText>
        </View>
      </ModuleCard>

      <PressableScale
        onPress={() => router.replace(faithRoutes.duas)}
        accessibilityRole="button"
        accessibilityLabel="Open the Duas library"
        style={[
          styles.link,
          {
            minHeight: dp(moduleLayout.minTouchTarget),
            borderRadius: dp(moduleLayout.radiusSmall),
            paddingHorizontal: dp(12),
          },
        ]}
        testID="faith-dua-detail-unknown-back"
      >
        <ModuleText token="button" color={EMERALD_DEEP} numberOfLines={2}>
          Open the Duas library
        </ModuleText>
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  link: {
    alignItems: 'center',
    backgroundColor: moduleNeutrals.surface,
    borderColor: moduleNeutrals.border,
    borderWidth: 1,
    justifyContent: 'center',
  },
});
