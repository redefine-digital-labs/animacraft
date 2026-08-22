import { gunzipSync } from 'node:zlib';

import {
  MAKER_V8_MAINNET_CHAIN_IDENTIFIER,
  attestMakerV8Runtime,
} from '../../maker-v8-chain.js';

const bytes32 = (value) => Array(32).fill(value);
const id = (value) => `0x${BigInt(value).toString(16).padStart(64, '0')}`;
const digest = '11111111111111111111111111111111';
const CORE_BASE_REGISTRY_MODULE_GZIP_BASE64 = 'H4sICGU0iWoCA2Jhc2VfcmVnaXN0cnlfdjgubXYApVnplxxHUs/MqqzKOvqcvuaQNK2Z0Ui2NLKk8bhsy4cOH2NblizJki953NNdktrq6R53t65lgYXdheVeYAFzLst9LmDO3eX4zGe+wBfe4xs83uMv4D34RVZXdfXM2Pt4yM6oiF9EZkZERmZWTX9j7j89mzHpczYtpjvGl/k/meY/y3fkJ9Z/m/Y3ve/U1H8sfGD94+JXhfsvh/5N+N8+8q/7Mx+/3Ml9aV2wp9hH/Gm+yT/Hf4eLt8R74oH4Nhff4YxjTIZmKMYqePpoNloJbQoti2ai5dGqaBk0hVYmX9AKaDnBmDAYdxTjrsKYpmdzqIs2UxbatMncGmz+DirGXmNgXybyEpFXibxI5BUidw2TsaG0GHvHhkuzGJPdcz30W/Kp98EM0XqW6GKO6Hye6EKB6K/zIj2Wp0qgK2Xif4t7iPAJzZ+cInqkAmC9WmNsbhrc6gzI2izII3MgR/eBPLof5LEDICfmQR6HY+wfOINr7yq49pd8FuMcmIPBj/CZOmM/pemP8hnAP8lngP+Y5n9a0x/X9Kt85iBjP6H58wuLjD23sMTYs4eWGTt3+AhjZx95lLHniTxz6ChjZxaOMfZXfHGFsb/hi+jz13wR435+CcAP8CUA37sEt76fuC/wJQz9g5p+3xKs2suwuk3k5jKMPlwG9if8COQ/1PSPNf2mpr/Pjxxn7A80/V2N/B4/Avs/40cw3J9q/uJRwJeJvHH0McYuHT3A+OG3kUx+7HGix9eInnqC6Md87QAev8jXOB6/FEm/wtfqePyqBsVf8JMoE+M3uVLMPP3KSWQ2fOUgZ/LQygFmzTzHhG1ap0+/R48bpw9y2357lXFDNU/W0WUQPMmc3+ZA1I0Tb66+u/re6lur11ffXn1ntbLaevrGM5vPts7cOLt5rvXCjRc3X/pgfWO99eqN1zYvbL6+ebH1xo3Lm1dab964tnn9phe+dW21unrbu7rafL15ofls81zzpebF5pXmdUzHhWXof1wx2xXp/7jioIK7QuLhCgOM5ZW4wyw1pZjitprmSihbiQQ2VEVVYOjtAoXBMZKzC4fGFbk9YFXxynxE6D9XfEr/7G5YRB2MNCysWDBUFTrDSveBIAyYMDwM0yYJEwJFY2icdKQGi/+5hZRYCJWrKicdZgTuofmGlrScMUe8lrJkZ4Cx0HJoeTQodIg8y1WBWw4zDcyMUR02do9HnBk9VNXA9FH6a4YylEeLRd7XHNSLJwhC7JAcFJSpfNKbXPmCBENJlSFEcpURJBgKzhESOUODWBzuEkzrawmllGUoR+XIyuEqJ0gwlKvyhLhc5QUJXBVl7GTkpsGpujCQDtvhJsc/wY3Zs41BeD682e62h+1e91xva6s93Aq7w8G1oLJTd1fD+yfhy+Gt9mDYf3glbHTC1rWgtrf6WuCe63V6/VfDhL3cu38tEOvnnfVhuKVxzWk4d6FxJ+yfaW21u+ca29cCT8uXe73htcC6uE0jO5ca/WHUjTjdrXap3xuGzWHYujJ82AnXu63wgTapXe51Ou3urXGA693tuxjMuXy3E0ajEKdHsa4M+7DN7RjD1XKK1cbu1X6jeSdCNatR5+qDc73uMHwwNN5cP280Wq1yo3Wv0W2GG83EhY17QT5G+6M8OY1bt8A3hmEp4VJdqnuBGCfX2N4Ouy2ASCzk7EhuI6EpcRuJSol9RJzqPKCgUvKQwoGsGoONzYfDcDDTGAxCjNBoDtv3GrQI8LvRegib+ZFqE6ufBLPRbsG99pAMaiODJny/1YNuEH50N0ToxVgxrr3abmgD1o3OVKK4m2DlEdbqN27CNSoZTFefQPdyKDdhcS/wRvLtxuB27EAXEYZb27DfxIytsBUrdg1YjRUo0fQs+0Z4lNtoefrhzbBPoQ9i3+81Ou1WkpqpSVTHGnt7v98eNjY7YYZkpLvT28R0fiQNbjdOPr6Wn1yDe4Gx2RxYm71+v3c/Fz3GdTKS4zoZiaM6ORSL8a4ahXEnREIQO22NVK9ROc2NxD1tcxPKsZzUWpyEQlIosa/5BBl5Owbiuk6AfqN7KxzrR56Nx4ynHyOxA17zdqPbDTvkeCGaOoWUdiHoMhuB242HnV6jNbkxM6Mlv7XZgDQVSYP7jWHz9qi3pbGB3ez1yaNiK7zZuNsZpozyreQ4jarBavW2Gu1upvWw29hqNzdutsNOywwx61xUrancpXwpjJTjXSXDe3hY4QOUyqAUPtiOVjllkUuBVIfVRI73b6Rw9Jl0B8ts0gYS7ZbUS263BxuD3lZY0GuWGNFKawTheTFDS6p5vZwRMDMC9kitJNXAgJ1JQ8pOYzPs5DqNh2F/tJpQqU6o9/9NtUU3CK3IiAn7AyTU6Ib3D6JFB9dEosdnD7bx3iZ3I+2BvbSpDZjp4iJIEmb1Nj9ECnO9Tezoe0lmrZ6+1lQcvJfKgh/xUeJmtLBnSkpahbOlhQh7/ZYOOD8CP7rb7oetBEjWD5sw2j/tQXtT7wpJ8qC4ewq13Q/vtXt3B05yJJR3Hg46Gi91QGZTPAafTsSJhZjQTOQLmkqi0Z7qKeiQH8N7OQGLhcRCH8xNupO7w8mkTU3aaCeLCTbQ7zWAqgkUFVc8hZ9Ot4rTbNKOd/rtW7d19U31o/ePdFlVP8WlmU939ZBWJVtwz4KE2ZE9zBLvJwa0RyG749DLmt25Ng4d0volQNJhOpinvHxWzVtR4lS8iooupw1cT3UwOOk+o6sfWUTbxBrol7FKtK4Ttx45m4aj6492SPq23XFWR6rdhyydj5EudRw5yR3mj28zvMtEwo6jZjxCaufOxsgeu7U40iW1S1kjaOCO/VLDXpT37LA3RMqTskvPOxsJe85SjnQ7DgVLowOFR3eA1xF3+CAquQdDe7Tq7nj17dHZ4H0u7PdG5xX7//3j30UvDHyxR/8MNR+D+KKn7xZ8DxuCm4JLwf/HUPFghvovEXNfmYq5/HLM/bsRc19IhmZJD5ZgPOFEwhkJZyacTDgr4eyEcxLOHXGumK41uu2tRpPeOY/dC47TLjimr2V8wEE/M72HPnodx4fot7jxRW7cMT7hxhXj6/RnA/tb+Bz/ItodV3yCxxVXfB2PffguFpmmqv0tN34ZH8d94xeAbij2ULH3Ff95rvh94wPjh7nxDU6Z7KiKqakU4ntU5ZaqWMKImD/C96gteAu5AHGEuKAqf871HwJg7wn5G9wA01WVn+HGlzALPm8TaEsA/FnO/55zUmWEBVU0LrQNQWBW+AlIk/VU5XX9Lf6mprALVOVJV/xQNEZOjzFyAsqv8SzBeQ13aMptVfk56AgtCPu6K5AECv8F8WVQWP0aHkUhKTFfQbtGedjvCl1FwkZB8IgTggqOOEMwI+JMwcyIk4LJiLMEsyLOFoz+HGn6HvO4JzzDMz1ZZL6VtQpzHuyotKxMWutZRe7bWbuwz0NvB/oThSwrzLu8cNCesRnZ2rNxfTF7tljwkbOAFd4XzCXzWTLPiqhL1jwjEuNF05cYedmei8aJ5sQAMiujATyU9akzLnQBxxBzWaOwz2WB8FGzgeFboGYJ7onCki9d5irXytoBuMByZd08IJc8xj2T22zZY4GdNfKsbh6VjxFUXfbMwi3MrDzLtT1RWMDsdmExcc+TCesUkWwf0Tz1nMtWyNMAHqzYwjUKtaxpZwv1rLQdUBtxmkWDHMxzVwXOvDkn5+GFXV52Rxn17KLnO1kncH3XZTkOD5zAQweRN0pWvLsrUImcUfaYTXlxCzOCZaB8/uyEC8YuF1ztAhZZu+AF/p4u0KSeW/R9P+sHGT+jHfE8P8hqR8ydjpjkiAFHMuRIlv50e3HCEXPCEaKWdkfBHXIELgV+7Ell2TVdWZS+o3VOkJs3H5XHdztZzPhu1g3yFA0chMtBQTsodzooyUETDnrkYA7Kl7GT0h7KPTwkamuqgiKWpFg398l65CJB5lHQKW3gjJ6uDsuzc6A+SjsbB0gBBTnzWXl2FCKhdtEIHHNdXhiH7VpFy89pbS4ozZtvyxt7rw6th5vxssWsn8/mg7JfoCS4OS8fVDRHibBKRRvjVEfCjqxYZS9jfsxH1napqLxcUNPshKVN2ZPIXoGyl4fq0vmJ5FmfsbwUuZMs5fS8OS8X91jKnF7KmdRSzmqn1U6nFTljxUtZgPLquQln7JQzll4IW1PtTNFNXJmbxxmwsIcree3KvpQr+7Urzk5XHHLFjl0pknIt5UreLYF4pbqZlUWah9GqCzS/QCNiW+WzhQPoUZiFeS5XBpBHn5XggO6oV8KDYZ6VisVgXrApmuO4y4O6PvcOwiJXQoazNHx+OT1nVc5+1px6ChrYo0kEo5+CmO2S69zTYwtWphcHA4fjgmD0axDLRfpobo/mntfHdH5ZsCoZnMSghZKNg9SWGY9z8mB62eWj+Si4fJHIVLAYhcgDq27W5fLImM5ilDNNYNfN4/IEjmLBahj6nUVX6PhobI9sS2Tre7ww7cMLaOUhcw73hPTMyoJvyP2OjzMJgy/AVDD6FYt1XG6LuumMD3KGc1UANeomOWZQQkyNmHVzQSMuIRXgUuO4PNZSuEs4aS2tRTgXdmld0pKNKgnciQjt9qfYuGRDlg4sEWRtmdEvb+xrPPJcJ6/kcb16pZJLtwxdFJlcqSw/H8VxOG1TTtuUIxtEdjptU0nbVCIbRHkpbVNN21QjG8TaStvU0ja1yAaxPkjbTKdtpmETRalNbBUXJW61kQkr61Ufbz0PZVgWjH6KfHctWUefu/GRt2Cekq7e5LxoB0u+QbxnlIJDvsDb1gwd3FpNPPwS+Vk8ijiczMNyJTqKPcE9Pp7Tx9s6FILRb583tvTapV5VMhqwnSXY5RwfXc2irNBIU8t6iVO2Cxqw3SVfyCXHF57ArEcTW5m2fVIDtocY5NNRNY8uEG1rpW0vasD2l3xTvuH4pmeaV+Vbia2iYcwN2YwQXWB2Zsn8UHYgCrZvdKzlS/rGKmta0bSqaU3T6QKu6Dxe2gSjH3/Z9aiMOQh2lcwl21hHCdwEXpP707gkXAJflsfSuEW4BXxNnk7jinAF/AX5avqYcFBSIHXEeQ2IYPRLNHuLYkCHUvoMqtI4ZaBl7CA5k0YrQCvpI0ijVaDVurkiV9NoDWitbj4tz6TRaaDTdfNl+XqCUo7gHM7BN+V1fYTpz0DHY2eEzeumJRXebQWrA3wft0ihcUagTo10TeFe4VQkuahIiiiEIrochPbgqsvoMLAVCm4FPDZ9Nuaxucsxj008F/PYrAsxj035iOZxgam6LtgT8hS2oWALNH3yUcj+T0wRHyCLxFTJv4JDnmlqaio1tTS1Cw7NXXCK2FX06zyrffcTsSLYIR7dSXlMtTzigwOCHSbe9OiOEexILBQhPBL3mBLs0VjhQnGUBOlFr9aCHRuLOP/ZSmyag3A8FuiqfIwEy6NDheMFDjk7kUbM4LBgJ/V1GiGewKvfEcFOEaZizDOKVnBIsNV0XxxXgj2eRlTwiGBrk6M5waOCPZG2coOjggVxoHOCPRk7vA8OPxUr9gv2dMwjZ6djo3kYPRMLdQjPxsJBCM/FwgKE52NhEcKZeDB4fTbmEdO5mEduzscdDqPDC7EC6Xgx5hHgSzGPwF6OeYS0HvPHBHsl5vGu9WrMzwr2WsyvCHYh5o8L9no88WOY+GKsOCHYpZg/KdgbMX9KsMtxh1V0uBIrHsc3Nb5+9ZcpR9EZuAhMJoWDu0QKhU9tXwjBhSHwcR39Ms1Njq/UrIXFwnulz33mG/SK4lu+neEZkTEzMotv1qyRxbbNOlk36+U4fUflJLvK/hdF1VWOxCQAAA==';
export const CORE_BASE_REGISTRY_MODULE_BASE64 = gunzipSync(
  Buffer.from(CORE_BASE_REGISTRY_MODULE_GZIP_BASE64, 'base64'),
).toString('base64');

function moveObject(type, objectId, fields) {
  return {
    data: {
      objectId,
      version: '1',
      digest,
      type,
      owner: { Shared: { initial_shared_version: '1' } },
      content: {
        dataType: 'moveObject',
        type,
        fields: { id: { id: objectId }, ...fields },
      },
    },
  };
}

export function runtimeAttestationRpc(runtime, methods = {}) {
  const runtimeRoles = Object.keys(runtime.roles);
  const companionRoles = ['seal', 'runtime', 'output', 'physical', 'market', 'release'];
  const authorities = Object.fromEntries(companionRoles.map((role, index) => [role, id(9_000 + index)]));
  const roleCommitments = Object.fromEntries(Object.keys(runtime.roles).map((role, index) => [role, bytes32(40 + index)]));
  const productBindingCommitment = bytes32(60);
  const callCapSetCommitment = bytes32(61);
  const bindings = Object.fromEntries(Object.entries(runtime.roles).map(([role, identity], index) => [role, {
    fields: {
      original_package_id: identity.typeOriginPackageId,
      callable_package_id: identity.callablePackageId,
      source_commitment: bytes32(10 + index),
      package_commitment: bytes32(20 + index),
      abi_commitment: bytes32(30 + index),
      commitment: roleCommitments[role],
    },
  }]));
  const catalog = moveObject(
    `${runtime.roles.core.typeOriginPackageId}::package_binding_v8::ProductReleaseCatalogV8`,
    runtime.catalogId,
    {
      version: '8',
      protocol_config_id: runtime.protocolConfigId,
      protocol_config_revision: '7',
      protocol_config_commitment: bytes32(4),
      binding: { fields: {
        version: '8', native_capability_mask: '127', ...bindings,
        commitment: productBindingCommitment,
      } },
      call_cap_set: { fields: {
        version: '8', catalog_id: runtime.catalogId,
        product_binding_commitment: productBindingCommitment,
        ...Object.fromEntries(companionRoles.map((role) => [`${role}_authority_id`, authorities[role]])),
        commitment: callCapSetCommitment,
      } },
      ...Object.fromEntries(companionRoles.map((role) => [`${role}_call_cap`, []])),
    },
  );
  const configTypes = {
    seal: ['seal_v8', 'SealPolicyConfigV8'],
    runtime: ['runtime_binding_v8', 'RuntimePackageConfigV8'],
    output: ['output_v8', 'OutputPackageConfigV8'],
    physical: ['physical_v8', 'PhysicalPackageConfigV8'],
    market: ['market_v8', 'MarketPackageConfigV8'],
    release: ['release_v8', 'ReleasePackageConfigV8'],
  };
  const configs = Object.fromEntries(companionRoles.map((role) => {
    const [moduleName, typeName] = configTypes[role];
    return [role, moveObject(
      `${runtime.roles[role].typeOriginPackageId}::${moduleName}::${typeName}`,
      runtime.roleConfigIds[role],
      {
        version: '8',
        catalog_id: runtime.catalogId,
        product_binding_commitment: productBindingCommitment,
        call_cap_set_commitment: callCapSetCommitment,
        [`${role}_call_cap`]: { fields: {
          version: '8', authority_id: authorities[role], catalog_id: runtime.catalogId,
          product_binding_commitment: productBindingCommitment,
          role_binding_commitment: roleCommitments[role],
          call_cap_set_commitment: callCapSetCommitment,
        } },
      },
    )];
  }));
  return {
    ...methods,
    async getChainIdentifier() { return MAKER_V8_MAINNET_CHAIN_IDENTIFIER; },
    async getObject({ id: objectId }) {
      if (objectId === runtime.catalogId) return catalog;
      const packageIndex = runtimeRoles.findIndex((role) => runtime.roles[role].callablePackageId === objectId);
      if (packageIndex >= 0) return {
        data: {
          objectId,
          version: '1',
          digest: String(packageIndex + 2).repeat(44),
          owner: { Immutable: true },
          bcs: {
            dataType: 'package', id: objectId, version: '1',
            moduleMap: packageIndex === 0 ? { base_registry_v8: CORE_BASE_REGISTRY_MODULE_BASE64 } : {},
          },
        },
      };
      const role = companionRoles.find((candidate) => runtime.roleConfigIds[candidate] === objectId);
      if (!role) throw new Error(`unexpected runtime attestation object ${objectId}`);
      return configs[role];
    },
  };
}

export async function attestFixtureRuntime(runtime, methods = {}) {
  return (await attestMakerV8Runtime(runtimeAttestationRpc(runtime, methods), runtime)).runtime;
}
