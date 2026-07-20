import { Dimensions, StyleSheet } from 'react-native';

const originalCreate = StyleSheet.create.bind(StyleSheet);
let inventoryStylesPatched = false;

(StyleSheet as any).create = (styles: Record<string, any>) => {
  const isInventoryStyles = Boolean(
    styles?.compactAssetRow
    && styles?.compactAssetText
    && styles?.compactAssetRight,
  );

  if (!inventoryStylesPatched && isInventoryStyles && Dimensions.get('window').width <= 700) {
    inventoryStylesPatched = true;
    styles = {
      ...styles,
      compactAssetRow: {
        ...styles.compactAssetRow,
        flexWrap: 'wrap',
        alignItems: 'flex-start',
      },
      compactAssetText: {
        ...styles.compactAssetText,
        minWidth: 0,
        flexBasis: 170,
        flexGrow: 1,
        flexShrink: 1,
      },
      compactAssetRight: {
        ...styles.compactAssetRight,
        width: '100%',
        maxWidth: '100%',
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        alignItems: 'center',
        alignSelf: 'stretch',
        gap: 8,
        marginTop: 2,
      },
      compactStatus: {
        ...styles.compactStatus,
        alignSelf: 'center',
      },
    };
  }

  return originalCreate(styles as any);
};
